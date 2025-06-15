import { WorkerEntrypoint } from 'cloudflare:workers'

interface Env {
  SLACK_BOT_TOKEN: string
  SLACK_APP_TOKEN: string
  SLACK_TEAM_ID: string
  SHARED_SECRET: string
  GITHUB_TOKEN?: string
  GITHUB_REPO?: string
  GITHUB_OWNER?: string
}

interface SlackChannel {
  id: string
  name: string
  is_private: boolean
  num_members?: number
}

interface SlackMessage {
  user: string
  text: string
  ts: string
}

interface SlackUser {
  id: string
  name: string
  real_name: string
  display_name: string
}

interface TaskMessage {
  user: string
  text: string
  timestamp: string
  permalink: string
}

interface TaskFileData {
  fileName: string
  date: string
  users: Array<{
    userName: string
    tasks: string[]
    lastUpdated: string
  }>
}

interface MCPRequest {
  jsonrpc: string
  id: number | string
  method: string
  params?: any
}

interface MCPResponse {
  jsonrpc: string
  id: number | string
  result?: any
  error?: {
    code: number
    message: string
  }
}

interface SlackEvent {
  type: string
  channel: string
  user: string
  text: string
  ts: string
  thread_ts?: string
}

interface SlackEventPayload {
  token: string
  team_id: string
  api_app_id: string
  event: SlackEvent
  type: string
  event_id: string
  event_time: number
}

export default class NorosiTaskMCP extends WorkerEntrypoint<Env> {
  constructor(ctx: ExecutionContext, env: Env) {
    super(ctx, env)
  }

  /**
   * Slackチャンネル一覧を取得します
   * @returns {Promise<string>} チャンネル一覧のJSON文字列
   */
  async listChannels(): Promise<string> {
    try {
      const response = await fetch('https://slack.com/api/conversations.list', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.env.SLACK_BOT_TOKEN}`,
          'Content-Type': 'application/json'
        }
      })
      
      const data = await response.json() as { ok: boolean, channels?: SlackChannel[], error?: string }
      
      if (!data.ok) {
        throw new Error(`Slack API error: ${data.error || 'Unknown error'}`)
      }
      
      const channels = data.channels?.map(channel => ({
        id: channel.id,
        name: channel.name,
        is_private: channel.is_private,
        member_count: channel.num_members
      })) || []
      
      return JSON.stringify(channels, null, 2)
    } catch (error) {
      return `エラー: ${error instanceof Error ? error.message : 'Unknown error'}`
    }
  }

  /**
   * ユーザー一覧を取得します
   * @returns {Promise<SlackUser[]>} ユーザー一覧
   */
  async getUsers(): Promise<SlackUser[]> {
    try {
      const response = await fetch('https://slack.com/api/users.list', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.env.SLACK_BOT_TOKEN}`,
          'Content-Type': 'application/json'
        }
      })
      
      const data = await response.json() as { ok: boolean, members?: SlackUser[], error?: string }
      
      if (!data.ok) {
        throw new Error(`Slack API error: ${data.error || 'Unknown error'}`)
      }
      
      return data.members?.filter(user => !user.id.startsWith('B') && user.name !== 'slackbot') || []
    } catch (error) {
      console.error('Error fetching users:', error)
      return []
    }
  }

  /**
   * ユーザー名からユーザーIDを取得します
   * @param userName {string} ユーザー名（表示名または実名）
   * @returns {Promise<string|null>} ユーザーID
   */
  async findUserByName(userName: string): Promise<string | null> {
    const users = await this.getUsers()
    
    // 完全一致を優先
    let user = users.find(u => 
      u.name === userName || 
      u.real_name === userName || 
      u.display_name === userName
    )
    
    // 部分一致も試す
    if (!user) {
      user = users.find(u => 
        u.name.includes(userName) || 
        u.real_name.includes(userName) || 
        u.display_name.includes(userName)
      )
    }
    
    return user?.id || null
  }

  /**
   * 特定ユーザーのタスク状況を分析します
   * @param userId {string} ユーザーID
   * @returns {Promise<string>} タスク分析結果
   */
  async analyzeUserTasks(userId: string): Promise<string> {
    try {
      const users = await this.getUsers()
      const user = users.find(u => u.id === userId)
      const userName = user?.real_name || user?.display_name || user?.name || 'Unknown User'
      
      // GitHubからタスクファイルを読み取り
      const taskData = await this.getTasksFromGitHub(userName)
      
      if (!taskData || taskData.length === 0) {
        // GitHubからデータが取得できない場合は、従来のSlack検索にフォールバック
        return await this.analyzeUserTasksFromSlack(userId, userName)
      }
      
      return this.formatTaskFileAnalysis(userName, taskData)
    } catch (error) {
      return `❌ エラー: ${error instanceof Error ? error.message : 'Unknown error'}`
    }
  }

  /**
   * GitHubからタスクファイルを読み取り
   */
  private async getTasksFromGitHub(userName: string): Promise<TaskFileData[]> {
    if (!this.env.GITHUB_TOKEN || !this.env.GITHUB_REPO || !this.env.GITHUB_OWNER) {
      return []
    }

    try {
      // キャッシュバスター用のタイムスタンプ
      const timestamp = Date.now()
      
      // タスクフォルダーの内容を取得
      const response = await fetch(
        `https://api.github.com/repos/${this.env.GITHUB_OWNER}/${this.env.GITHUB_REPO}/contents/タスク?t=${timestamp}`,
        {
          headers: {
            'Authorization': `Bearer ${this.env.GITHUB_TOKEN}`,
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'NOROSHI-MCP-Server',
            'Cache-Control': 'no-cache'
          }
        }
      )

      if (!response.ok) {
        throw new Error(`GitHub API error: ${response.status}`)
      }

      const files = await response.json() as Array<{
        name: string
        download_url: string
        type: string
      }>

      const taskFiles: TaskFileData[] = []
      
      // ユーザー名のバリエーションを取得
      const nameVariations = await this.getUserNameVariations(userName)
      console.log(`[DEBUG] Searching GitHub for user variations:`, nameVariations)

      // .mdファイルのみを処理
      for (const file of files.filter(f => f.name.endsWith('.md') && f.type === 'file')) {
        try {
          // ファイル内容取得時にもキャッシュバスターを追加
          const fileResponse = await fetch(`${file.download_url}?t=${timestamp}`, {
            headers: {
              'Cache-Control': 'no-cache'
            }
          })
          const content = await fileResponse.text()
          
          // 各名前バリエーションで検索
          for (const nameVariation of nameVariations) {
            const parsedData = this.parseTaskFile(file.name, content, nameVariation)
            if (parsedData) {
              console.log(`[DEBUG] Found tasks for ${nameVariation} in ${file.name}`)
              taskFiles.push(parsedData)
              break // 見つかったら他のバリエーションは試さない
            }
          }
        } catch (error) {
          console.error(`Error reading file ${file.name}:`, error)
        }
      }

      return taskFiles.sort((a, b) => b.date.localeCompare(a.date)) // 日付順でソート
    } catch (error) {
      console.error('Error fetching from GitHub:', error)
      return []
    }
  }

  /**
   * ユーザー名のバリエーションを取得
   */
  private async getUserNameVariations(userName: string): Promise<string[]> {
    const variations: string[] = [userName]
    
    try {
      // Slackユーザー情報から他の名前パターンを取得
      const users = await this.getUsers()
      const user = users.find(u => 
        u.name === userName || 
        u.real_name === userName || 
        u.display_name === userName
      )
      
      if (user) {
        // 実名、表示名、ユーザー名のすべてのバリエーションを追加
        if (user.real_name && !variations.includes(user.real_name)) {
          variations.push(user.real_name)
        }
        if (user.display_name && !variations.includes(user.display_name)) {
          variations.push(user.display_name)
        }
        if (user.name && !variations.includes(user.name)) {
          variations.push(user.name)
        }
        
        // @username形式も追加（過去のデータとの互換性のため）
        const atUsername = `@${user.name}`
        if (!variations.includes(atUsername)) {
          variations.push(atUsername)
        }
      }
      
      console.log(`[DEBUG] User name variations for ${userName}:`, variations)
      return variations
    } catch (error) {
      console.error('Error getting user name variations:', error)
      return variations
    }
  }

  /**
   * タスクファイルの内容を解析
   */
  private parseTaskFile(fileName: string, content: string, targetUserName: string): TaskFileData | null {
    const lines = content.split('\n')
    const date = fileName.match(/(\d{4}-\d{2}-\d{2})/)?.[1] || ''
    
    let currentUser = ''
    let tasks: string[] = []
    let lastUpdated = ''
    let inTaskSection = false
    let foundTargetUser = false
    
    for (const line of lines) {
      // ユーザーセクションの検出
      if (line.startsWith('## ')) {
        // 前のユーザーが対象ユーザーだった場合、データを保存
        if (currentUser === targetUserName && tasks.length > 0) {
          foundTargetUser = true
          break // 対象ユーザーのセクションが終了
        }
        
        // 新しいユーザーの開始
        currentUser = line.replace('## ', '').trim()
        inTaskSection = false
        tasks = []
        lastUpdated = ''
      }
      
      // 現在のタスクセクションの検出
      if (currentUser === targetUserName && line.includes('**現在のタスク:**')) {
        inTaskSection = true
        continue
      }
      
      // 最新の変更セクションの検出
      if (currentUser === targetUserName && line.includes('**最新の変更')) {
        const match = line.match(/\(([^)]+)\)/)
        if (match) {
          lastUpdated = match[1]
        }
        inTaskSection = false
        continue
      }
      
      // タスクの抽出
      if (currentUser === targetUserName && inTaskSection && line.startsWith('・')) {
        tasks.push(line.replace('・', '').trim())
      }
    }
    
    // ファイル終端での処理：最後のユーザーが対象ユーザーの場合
    if (currentUser === targetUserName && tasks.length > 0) {
      foundTargetUser = true
    }
    
    if (foundTargetUser && tasks.length > 0) {
      return {
        fileName,
        date,
        users: [{
          userName: targetUserName,
          tasks,
          lastUpdated
        }]
      }
    }
    
    return null
  }

  /**
   * タスクファイル分析結果をフォーマット
   */
  private formatTaskFileAnalysis(userName: string, taskData: TaskFileData[]): string {
    let result = `👤 **${userName}さんのタスク状況**\n\n`
    
    if (taskData.length === 0) {
      return `📋 ${userName}さんのタスクファイルが見つかりませんでした。`
    }
    
    const latestData = taskData[0]
    const userTasks = latestData.users[0]
    
    // デバッグ情報を追加
    console.log(`[DEBUG] User: ${userName}, File: ${latestData.fileName}, Tasks: ${JSON.stringify(userTasks.tasks)}`)
    
    result += `📊 **概要**: ${userTasks.tasks.length}件のタスクが登録されています\n`
    result += `📅 **最終更新**: ${userTasks.lastUpdated}\n`
    result += `📄 **ファイル**: ${latestData.fileName}\n\n`
    
    if (userTasks.tasks.length > 0) {
      result += `📝 **現在のタスク**:\n`
      userTasks.tasks.forEach((task, index) => {
        result += `${index + 1}. ${task}\n`
      })
      result += '\n'
    }
    
    // 過去のタスクファイルがある場合
    if (taskData.length > 1) {
      result += `📚 **過去のタスクファイル**: ${taskData.length - 1}件\n`
    }
    
    result += `\n💡 *データソース: GitHubタスクファイル*`
    
    return result
  }

  /**
   * Slackからタスクを分析（フォールバック用）
   */
  private async analyzeUserTasksFromSlack(userId: string, userName: string): Promise<string> {
    try {
      // 全チャンネルからユーザーのタスクを検索
      const channels = await this.getChannelsForTaskSearch()
      let allUserTasks: TaskMessage[] = []
      
      for (const channel of channels) {
        try {
          const taskMessages = await this.searchTaskMessages(channel.id, 100)
          const tasks = JSON.parse(taskMessages) as TaskMessage[]
          const userTasks = tasks.filter(task => task.user === userId)
          allUserTasks = allUserTasks.concat(userTasks)
        } catch (error) {
          // チャンネルアクセスエラーは無視
          continue
        }
      }
      
      if (allUserTasks.length === 0) {
        return `📋 ${userName}さんのタスクは見つかりませんでした。`
      }
      
      // 最新のタスクを時系列順にソート
      allUserTasks.sort((a, b) => parseFloat(b.timestamp) - parseFloat(a.timestamp))
      
      const analysis = {
        userName,
        totalTasks: allUserTasks.length,
        recentTasks: allUserTasks.slice(0, 5).map(task => ({
          text: task.text.substring(0, 150) + (task.text.length > 150 ? '...' : ''),
          timestamp: new Date(parseFloat(task.timestamp) * 1000).toLocaleString('ja-JP'),
          channel: this.getChannelNameFromPermalink(task.permalink)
        })),
        summary: `${userName}さんは合計${allUserTasks.length}件のタスクを投稿しています。`
      }
      
      return this.formatUserTaskAnalysis(analysis) + `\n\n💡 *データソース: Slackメッセージ履歴*`
    } catch (error) {
      return `❌ エラー: ${error instanceof Error ? error.message : 'Unknown error'}`
    }
  }

  /**
   * タスク検索用のチャンネル一覧を取得
   */
  private async getChannelsForTaskSearch(): Promise<SlackChannel[]> {
    try {
      const response = await fetch('https://slack.com/api/conversations.list?types=public_channel&limit=20', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.env.SLACK_BOT_TOKEN}`,
          'Content-Type': 'application/json'
        }
      })

      const data = await response.json() as { ok: boolean, channels?: SlackChannel[], error?: string }
      return data.ok ? (data.channels || []) : []
    } catch (error) {
      return []
    }
  }

  /**
   * パーマリンクからチャンネル名を抽出
   */
  private getChannelNameFromPermalink(permalink: string): string {
    const match = permalink.match(/archives\/([^\/]+)/)
    if (match) {
      const channelId = match[1]
      // 簡易的なチャンネル名マッピング
      const channelMap: Record<string, string> = {
        'C02TJS8D205': 'general',
        'C02TMQRAS3D': 'random',
        'C091H8NUJ8L': 'タスク'
      }
      return channelMap[channelId] || channelId
    }
    return 'unknown'
  }

  /**
   * ユーザータスク分析結果をフォーマット
   */
  private formatUserTaskAnalysis(analysis: any): string {
    let result = `👤 **${analysis.userName}さんのタスク状況**\n\n`
    result += `📊 **概要**: ${analysis.summary}\n\n`
    
    if (analysis.recentTasks.length > 0) {
      result += `📝 **最近のタスク**:\n`
      analysis.recentTasks.forEach((task: any, index: number) => {
        result += `${index + 1}. **[${task.channel}]** ${task.text}\n`
        result += `   📅 ${task.timestamp}\n\n`
      })
    }
    
    return result
  }

  /**
   * タスク状況問い合わせを処理
   */
  private async handleTaskStatusInquiry(text: string, channel: string, messageTs: string): Promise<void> {
    // メンションパターンとテキストパターンの両方に対応
    const mentionPatterns = [
      // メンション形式: <@USER_ID> タスク状況を教えて
      /<@([A-Z0-9]+)>\s*タスク状況を教えて/i,
      /<@([A-Z0-9]+)>\s*のタスク状況を教えて/i,
      /<@([A-Z0-9]+)>\s*タスクを教えて/i,
      /<@([A-Z0-9]+)>\s*のタスクを教えて/i,
      /<@([A-Z0-9]+)>\s*タスク状況/i,
      /<@([A-Z0-9]+)>\s*タスク/i,
      /<@([A-Z0-9]+)>\s*のタスク状況/i,
      /<@([A-Z0-9]+)>\s*タスク教えて/i,
      /<@([A-Z0-9]+)>\s*のタスク/i,
      
    ]
    
    const textPatterns = [
      // テキスト形式: ユーザー名さんのタスク状況を教えて
      /(.+?)さんのタスク状況を教えて/,
      /(.+?)のタスク状況を教えて/,
      /(.+?)さんのタスクを教えて/,
      /(.+?)のタスクを教えて/,
      /(.+?)さんのタスク状況/,
      /(.+?)のタスク状況/
    ]
    
    let userId: string | null = null
    let userName: string | null = null
    
    // まずメンションパターンをチェック
    for (const pattern of mentionPatterns) {
      const match = text.match(pattern)
      if (match) {
        userId = match[1].trim()
        // ユーザーIDから名前を取得
        userName = await this.getUserNameById(userId)
        break
      }
    }
    
    // メンションが見つからない場合、テキストパターンをチェック
    if (!userId) {
      for (const pattern of textPatterns) {
        const match = text.match(pattern)
        if (match) {
          userName = match[1].trim()
          // ユーザー名からIDを取得
          userId = await this.findUserByName(userName)
          break
        }
      }
    }
    
    if (!userId || !userName) return
    
    // タスク分析を実行
    const analysis = await this.analyzeUserTasks(userId)
    
    // 結果を投稿
    await this.postMessage(channel, analysis, messageTs)
  }

  /**
   * ユーザーIDから名前を取得
   */
  private async getUserNameById(userId: string): Promise<string | null> {
    try {
      const response = await fetch(`https://slack.com/api/users.info?user=${userId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.env.SLACK_BOT_TOKEN}`,
          'Content-Type': 'application/json'
        }
      })

      const data = await response.json() as { 
        ok: boolean, 
        user?: { 
          name: string, 
          real_name: string, 
          profile?: { display_name: string } 
        }, 
        error?: string 
      }
      
      if (!data.ok || !data.user) {
        return null
      }

      // 表示名 > 実名 > ユーザー名の優先順位で返す（タスク保存と統一）
      return data.user.profile?.display_name || data.user.real_name || data.user.name
    } catch (error) {
      return null
    }
  }

  /**
   * Slackにメッセージを投稿
   */
  private async postMessage(channel: string, text: string, threadTs?: string): Promise<void> {
    try {
      const payload: any = {
        channel,
        text,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text
            }
          },
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: `🤖 NOROSHI Auto Response | ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`
              }
            ]
          }
        ]
      }
      
      if (threadTs) {
        payload.thread_ts = threadTs
      }
      
      await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.env.SLACK_BOT_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      })
    } catch (error) {
      console.error('Error posting message:', error)
    }
  }

  /**
   * 指定されたチャンネルでタスクパターンのメッセージを検索します
   * @param channelId {string} チャンネルID
   * @param limit {number} 取得するメッセージ数（デフォルト: 50）
   * @returns {Promise<string>} タスクメッセージの一覧
   */
  async searchTaskMessages(channelId: string, limit: number = 50): Promise<string> {
    try {
      const response = await fetch(`https://slack.com/api/conversations.history?channel=${channelId}&limit=${limit}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.env.SLACK_BOT_TOKEN}`,
          'Content-Type': 'application/json'
        }
      })

      const data = await response.json() as { ok: boolean, messages?: SlackMessage[], error?: string }
      
      if (!data.ok) {
        throw new Error(`Slack API error: ${data.error || 'Unknown error'}`)
      }

      const taskPatterns = [
        /\[タスク\]/i,
        /\[本日のタスク\]/i,
        /\[今日のタスク\]/i,
        /\[task\]/i,
        /\[todo\]/i,
        /\[やること\]/i
      ]

      const taskMessages: TaskMessage[] = data.messages?.filter(message => {
        return message.text && taskPatterns.some(pattern => pattern.test(message.text))
      }).map(message => ({
        user: message.user,
        text: message.text,
        timestamp: message.ts,
        permalink: `https://${this.env.SLACK_TEAM_ID}.slack.com/archives/${channelId}/p${message.ts?.replace('.', '')}`
      })) || []

      return JSON.stringify(taskMessages, null, 2)
    } catch (error) {
      return `エラー: ${error instanceof Error ? error.message : 'Unknown error'}`
    }
  }

  /**
   * #generalチャンネルにタスクリマインダーを送信します
   * @param message {string} リマインダーメッセージ
   * @returns {Promise<string>} 送信結果
   */
  async sendTaskReminder(message: string): Promise<string> {
    try {
      const blocks = [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `🔔 *タスクリマインダー*\n${message}`
          }
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `🤖 NOROSHI MCP Server | ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`
            }
          ]
        }
      ]

      const response = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.env.SLACK_BOT_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          channel: 'C02TJS8D205', // #general channel ID
          text: `🔔 タスクリマインダー: ${message}`,
          blocks: blocks
        })
      })

      const data = await response.json() as { ok: boolean, ts?: string, error?: string }
      
      if (!data.ok) {
        throw new Error(`Slack API error: ${data.error || 'Unknown error'}`)
      }

      return `✅ リマインダーを送信しました (ts: ${data.ts})`
    } catch (error) {
      return `❌ エラー: ${error instanceof Error ? error.message : 'Unknown error'}`
    }
  }

  /**
   * 指定されたチャンネルの最新タスクを取得し、分析します
   * @param channelId {string} チャンネルID
   * @returns {Promise<string>} タスク分析結果
   */
  async analyzeChannelTasks(channelId: string): Promise<string> {
    try {
      const taskMessages = await this.searchTaskMessages(channelId, 100)
      const tasks = JSON.parse(taskMessages) as TaskMessage[]
      
      if (tasks.length === 0) {
        return '📋 このチャンネルにはタスクメッセージが見つかりませんでした。'
      }

      // ユーザー別タスク集計
      const userTasks = tasks.reduce((acc: Record<string, TaskMessage[]>, task) => {
        if (!acc[task.user]) {
          acc[task.user] = []
        }
        acc[task.user].push(task)
        return acc
      }, {})

      const analysis = {
        totalTasks: tasks.length,
        uniqueUsers: Object.keys(userTasks).length,
        userBreakdown: Object.entries(userTasks).map(([user, userTaskList]) => ({
          user,
          taskCount: userTaskList.length,
          latestTask: userTaskList[0]?.text?.substring(0, 100) + '...'
        })),
        recentTasks: tasks.slice(0, 5).map(task => ({
          user: task.user,
          preview: task.text.substring(0, 100) + '...',
          timestamp: new Date(parseFloat(task.timestamp) * 1000).toLocaleString('ja-JP')
        }))
      }

      return JSON.stringify(analysis, null, 2)
    } catch (error) {
      return `❌ エラー: ${error instanceof Error ? error.message : 'Unknown error'}`
    }
  }

  /**
   * Slackワークスペースの全体的なタスク状況を取得します
   * @returns {Promise<string>} ワークスペース全体のタスク状況
   */
  async getWorkspaceTaskOverview(): Promise<string> {
    try {
      // パブリックチャンネル一覧を取得
      const response = await fetch('https://slack.com/api/conversations.list?types=public_channel&limit=20', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.env.SLACK_BOT_TOKEN}`,
          'Content-Type': 'application/json'
        }
      })

      const data = await response.json() as { ok: boolean, channels?: SlackChannel[], error?: string }
      
      if (!data.ok) {
        throw new Error(`Slack API error: ${data.error || 'Unknown error'}`)
      }

      const channels = data.channels || []
      const overview = {
        totalChannels: channels.length,
        channelsWithTasks: [] as Array<{name: string, id: string, taskCount: number}>,
        totalTaskMessages: 0,
        summary: ''
      }

      // 各チャンネルのタスクを確認（最初の10チャンネルのみ）
      for (const channel of channels.slice(0, 10)) {
        try {
          const taskMessages = await this.searchTaskMessages(channel.id, 20)
          const tasks = JSON.parse(taskMessages) as TaskMessage[]
          
          if (tasks.length > 0) {
            overview.channelsWithTasks.push({
              name: channel.name,
              id: channel.id,
              taskCount: tasks.length
            })
            overview.totalTaskMessages += tasks.length
          }
        } catch (error) {
          // チャンネルアクセスエラーは無視
          console.log(`Channel access error for ${channel.name}:`, error)
        }
      }

      overview.summary = `📊 ワークスペース概要: ${overview.totalChannels}チャンネル中${overview.channelsWithTasks.length}チャンネルでタスクを発見。合計${overview.totalTaskMessages}件のタスクメッセージ。`

      return JSON.stringify(overview, null, 2)
    } catch (error) {
      return `❌ エラー: ${error instanceof Error ? error.message : 'Unknown error'}`
    }
  }

  /**
   * 現在の日本時間を取得します
   * @returns {Promise<string>} 現在の日本時間
   */
  async getCurrentJapanTime(): Promise<string> {
    const now = new Date()
    const japanTime = now.toLocaleString('ja-JP', { 
      timeZone: 'Asia/Tokyo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
    
    return `🕐 現在の日本時間: ${japanTime}`
  }

  /**
   * Cron Triggerハンドラー - 定期的なタスク報告
   */
  async scheduled(controller: ScheduledController): Promise<void> {
    const now = new Date()
    const hour = now.getUTCHours() + 9 // JST変換 (UTC+9)
    const minute = now.getUTCMinutes()
    
    try {
      let reportType = ''
      let reportMessage = ''
      
      // 時間帯に応じた報告タイプを設定
      if (hour === 9) {
        reportType = '朝のタスク状況'
        reportMessage = '🌅 **本日のタスク状況をお知らせします**'
      } else if (hour === 13) {
        reportType = '昼のタスク状況'
        reportMessage = '🍽️ **現在のタスク進捗状況をお知らせします**'
      } else if (hour === 15 && minute === 30) {
        reportType = '午後のタスク状況'
        reportMessage = '☕ **午後のタスク進捗状況をお知らせします**'
      } else if (hour === 17) {
        reportType = '夕方のタスク状況'
        reportMessage = '🌆 **本日のタスク完了状況をお知らせします**'
      }
      
      if (reportMessage) {
        // 全ユーザーのタスクを取得・報告
        await this.reportAllUserTasks(reportMessage, reportType)
        
        console.log(`✅ ${reportType}を自動報告しました`)
      }
    } catch (error) {
      console.error('Cron trigger error:', error)
    }
  }

  /**
   * 全ユーザーのタスクを取得してSlackに報告
   */
  private async reportAllUserTasks(headerMessage: string, reportType: string): Promise<void> {
    try {
      // GitHubから最新のタスクファイルを取得
      const allTaskData = await this.getAllUsersTasksFromGitHub()
      
      if (allTaskData.length === 0) {
        await this.sendTaskReport(`${headerMessage}\n\n📋 本日のタスクファイルが見つかりませんでした。`, reportType)
        return
      }
      
      // 報告メッセージを構築
      let reportContent = `${headerMessage}\n\n`
      
      const latestTaskFile = allTaskData[0] // 最新のファイル
      reportContent += `📅 **日付**: ${latestTaskFile.date}\n`
      reportContent += `📄 **ファイル**: ${latestTaskFile.fileName}\n\n`
      
      if (latestTaskFile.users.length === 0) {
        reportContent += '📋 登録されているタスクはありません。\n'
      } else {
        reportContent += `👥 **登録ユーザー数**: ${latestTaskFile.users.length}名\n\n`
        
        // 各ユーザーのタスクを報告
        for (const user of latestTaskFile.users) {
          reportContent += `## 👤 ${user.userName}\n`
          reportContent += `📊 **タスク数**: ${user.tasks.length}件\n`
          
          if (user.lastUpdated) {
            reportContent += `⏰ **最終更新**: ${user.lastUpdated}\n`
          }
          
          if (user.tasks.length > 0) {
            reportContent += `📝 **タスク一覧**:\n`
            user.tasks.forEach((task, index) => {
              reportContent += `${index + 1}. ${task}\n`
            })
          } else {
            reportContent += `📝 **タスク**: なし\n`
          }
          
          reportContent += '\n'
        }
      }
      
      reportContent += `\n⏰ ${reportType} - ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`
      reportContent += `\n💡 *データソース: GitHub タスクファイル*`
      
      // Slackに報告を送信
      await this.sendTaskReport(reportContent, reportType)
      
    } catch (error) {
      console.error('Error reporting all user tasks:', error)
      await this.sendTaskReport(`${headerMessage}\n\n❌ タスク報告中にエラーが発生しました: ${error}`, reportType)
    }
  }

  /**
   * GitHubから全ユーザーのタスクデータを取得
   */
  private async getAllUsersTasksFromGitHub(): Promise<TaskFileData[]> {
    if (!this.env.GITHUB_TOKEN || !this.env.GITHUB_REPO || !this.env.GITHUB_OWNER) {
      return []
    }

    try {
      // キャッシュバスター用のタイムスタンプ
      const timestamp = Date.now()
      
      // タスクフォルダーの内容を取得
      const response = await fetch(
        `https://api.github.com/repos/${this.env.GITHUB_OWNER}/${this.env.GITHUB_REPO}/contents/タスク?t=${timestamp}`,
        {
          headers: {
            'Authorization': `Bearer ${this.env.GITHUB_TOKEN}`,
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'NOROSHI-MCP-Server',
            'Cache-Control': 'no-cache'
          }
        }
      )

      if (!response.ok) {
        throw new Error(`GitHub API error: ${response.status}`)
      }

      const files = await response.json() as Array<{
        name: string
        download_url: string
        type: string
      }>

      const taskFiles: TaskFileData[] = []

      // .mdファイルのみを処理
      for (const file of files.filter(f => f.name.endsWith('.md') && f.type === 'file')) {
        try {
          // ファイル内容取得時にもキャッシュバスターを追加
          const fileResponse = await fetch(`${file.download_url}?t=${timestamp}`, {
            headers: {
              'Cache-Control': 'no-cache'
            }
          })
          const content = await fileResponse.text()
          const parsedData = this.parseAllUsersTaskFile(file.name, content)
          if (parsedData) {
            taskFiles.push(parsedData)
          }
        } catch (error) {
          console.error(`Error reading file ${file.name}:`, error)
        }
      }

      return taskFiles.sort((a, b) => b.date.localeCompare(a.date)) // 日付順でソート
    } catch (error) {
      console.error('Error fetching from GitHub:', error)
      return []
    }
  }

  /**
   * タスクファイルから全ユーザーのデータを解析
   */
  private parseAllUsersTaskFile(fileName: string, content: string): TaskFileData | null {
    const lines = content.split('\n')
    const date = fileName.match(/(\d{4}-\d{2}-\d{2})/)?.[1] || ''
    
    const users: Array<{
      userName: string
      tasks: string[]
      lastUpdated: string
    }> = []
    
    let currentUser = ''
    let currentTasks: string[] = []
    let currentLastUpdated = ''
    let inTaskSection = false
    
    for (const line of lines) {
      // ユーザーセクションの検出
      if (line.startsWith('## ')) {
        // 前のユーザーのデータを保存
        if (currentUser && currentTasks.length > 0) {
          users.push({
            userName: currentUser,
            tasks: [...currentTasks],
            lastUpdated: currentLastUpdated
          })
        }
        
        // 新しいユーザーの開始
        currentUser = line.replace('## ', '').trim()
        currentTasks = []
        currentLastUpdated = ''
        inTaskSection = false
      }
      
      // 現在のタスクセクションの検出
      if (currentUser && line.includes('**現在のタスク:**')) {
        inTaskSection = true
        continue
      }
      
      // 最新の変更セクションの検出
      if (currentUser && line.includes('**最新の変更')) {
        const match = line.match(/\(([^)]+)\)/)
        if (match) {
          currentLastUpdated = match[1]
        }
        inTaskSection = false
        continue
      }
      
      // タスクの抽出
      if (currentUser && inTaskSection && line.startsWith('・')) {
        currentTasks.push(line.replace('・', '').trim())
      }
    }
    
    // 最後のユーザーのデータを保存
    if (currentUser && currentTasks.length > 0) {
      users.push({
        userName: currentUser,
        tasks: [...currentTasks],
        lastUpdated: currentLastUpdated
      })
    }
    
    return {
      fileName,
      date,
      users
    }
  }

  /**
   * タスク報告をSlackに送信
   */
  private async sendTaskReport(message: string, reportType: string): Promise<void> {
    try {
      const blocks = [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: message
          }
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `🤖 NOROSHI 自動タスク報告 | ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`
            }
          ]
        }
      ]

      await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.env.SLACK_BOT_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          channel: 'C02TJS8D205', // #general channel ID
          text: `📋 ${reportType}`,
          blocks: blocks
        })
      })
    } catch (error) {
      console.error('Error sending task report:', error)
    }
  }

  /**
   * MCPプロトコルのハンドラー
   */
  async fetch(request: Request): Promise<Response> {
    // CORS対応
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      })
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 })
    }

    try {
      const body = await request.json() as any
      
      // Slack Events API のリクエストを処理
      if (body.type === 'url_verification') {
        return new Response(body.challenge, {
          status: 200,
          headers: { 'Content-Type': 'text/plain' }
        })
      }
      
      // Slack Events API のイベントを処理
      if (body.type === 'event_callback') {
        const event = body.event as SlackEvent
        
        // デバッグログ追加
        console.log('🔍 Slack Event Received:', {
          type: event.type,
          channel: event.channel,
          user: event.user,
          text: event.text?.substring(0, 100) + '...',
          timestamp: event.ts,
          hasBot: event.user?.startsWith('B'),
          isBot: !event.user || event.user.startsWith('B') || event.user.startsWith('U091UQ2ATPB') // NOROSHI-AI bot
        })
        
        // #generalチャンネルと#タスクチャンネルのメッセージを処理
        const targetChannels = ['C02TJS8D205', 'C091H8NUJ8L'] // #general, #タスク
        if (event.type === 'message' && targetChannels.includes(event.channel) && event.text) {
          console.log('✅ Target channel message detected:', {
            channel: event.channel,
            channelName: event.channel === 'C02TJS8D205' ? 'general' : 'タスク'
          })
          
          // ボット自身のメッセージは無視（無限ループ防止）
          // NOROSHI-AI bot (U091UQ2ATPB) のメッセージも無視
          if (event.user && !event.user.startsWith('B') && event.user !== 'U091UQ2ATPB') {
            console.log('✅ Human user message, processing...', {
              userId: event.user,
              channel: event.channel
            })
            
            // タスクパターンの自動転送処理
            await this.handleTaskMessage(event.text, event.channel, event.user, event.ts)
            
            // タスク状況問い合わせ処理
            await this.handleTaskStatusInquiry(event.text, event.channel, event.ts)
          } else {
            console.log('⚠️ Bot message ignored to prevent infinite loop:', {
              user: event.user,
              channel: event.channel,
              textPreview: event.text?.substring(0, 50) + '...',
              reason: event.user?.startsWith('B') ? 'Slack bot' : event.user === 'U091UQ2ATPB' ? 'NOROSHI-AI bot' : 'No user ID'
            })
          }
        } else {
          console.log('⚠️ Message not processed:', {
            type: event.type,
            channel: event.channel,
            isTargetChannel: targetChannels.includes(event.channel),
            hasText: !!event.text,
            reason: !targetChannels.includes(event.channel) ? 'not target channel' : 
                   !event.text ? 'no text' : 'wrong type'
          })
        }
        
        return new Response('OK', { status: 200 })
      }
      
      // MCPプロトコルの処理
      const mcpRequest = body as MCPRequest
      
      // MCPプロトコルの基本検証
      if (mcpRequest.jsonrpc !== '2.0') {
        return this.createErrorResponse(mcpRequest.id, -32600, 'Invalid Request')
      }

      let result: any

      switch (mcpRequest.method) {
        case 'initialize':
          result = {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {}
            },
            serverInfo: {
              name: 'noroshi-mcp-server',
              version: '1.0.0'
            }
          }
          break

        case 'tools/list':
          result = {
            tools: [
              {
                name: 'listChannels',
                description: 'Slackチャンネル一覧を取得します',
                inputSchema: {
                  type: 'object',
                  properties: {},
                  required: []
                }
              },
              {
                name: 'searchTaskMessages',
                description: 'タスクパターンのメッセージを検索します',
                inputSchema: {
                  type: 'object',
                  properties: {
                    channelId: { type: 'string', description: 'チャンネルID' },
                    limit: { type: 'number', description: '取得するメッセージ数', default: 50 }
                  },
                  required: ['channelId']
                }
              },
              {
                name: 'sendTaskReminder',
                description: 'タスクリマインダーを送信します',
                inputSchema: {
                  type: 'object',
                  properties: {
                    message: { type: 'string', description: 'リマインダーメッセージ' }
                  },
                  required: ['message']
                }
              },
              {
                name: 'analyzeChannelTasks',
                description: 'チャンネルのタスクを分析します',
                inputSchema: {
                  type: 'object',
                  properties: {
                    channelId: { type: 'string', description: 'チャンネルID' }
                  },
                  required: ['channelId']
                }
              },
              {
                name: 'analyzeUserTasks',
                description: '特定ユーザーのタスク状況を分析します',
                inputSchema: {
                  type: 'object',
                  properties: {
                    userName: { type: 'string', description: 'ユーザー名' }
                  },
                  required: ['userName']
                }
              },
              {
                name: 'getWorkspaceTaskOverview',
                description: 'ワークスペース全体のタスク状況を取得します',
                inputSchema: {
                  type: 'object',
                  properties: {},
                  required: []
                }
              },
              {
                name: 'getCurrentJapanTime',
                description: '現在の日本時間を取得します',
                inputSchema: {
                  type: 'object',
                  properties: {},
                  required: []
                }
              },
              {
                name: 'testScheduledTask',
                description: 'scheduled関数をテスト実行します',
                inputSchema: {
                  type: 'object',
                  properties: {},
                  required: []
                }
              }
            ]
          }
          break

        case 'tools/call':
          const toolName = mcpRequest.params?.name
          const args = mcpRequest.params?.arguments || {}

          switch (toolName) {
            case 'listChannels':
              result = {
                content: [
                  {
                    type: 'text',
                    text: await this.listChannels()
                  }
                ]
              }
              break

            case 'searchTaskMessages':
              result = {
                content: [
                  {
                    type: 'text',
                    text: await this.searchTaskMessages(args.channelId, args.limit)
                  }
                ]
              }
              break

            case 'sendTaskReminder':
              result = {
                content: [
                  {
                    type: 'text',
                    text: await this.sendTaskReminder(args.message)
                  }
                ]
              }
              break

            case 'analyzeChannelTasks':
              result = {
                content: [
                  {
                    type: 'text',
                    text: await this.analyzeChannelTasks(args.channelId)
                  }
                ]
              }
              break

            case 'analyzeUserTasks':
              const userId = await this.findUserByName(args.userName)
              if (!userId) {
                result = {
                  content: [
                    {
                      type: 'text',
                      text: `❓ ユーザー「${args.userName}」が見つかりませんでした。`
                    }
                  ]
                }
              } else {
                result = {
                  content: [
                    {
                      type: 'text',
                      text: await this.analyzeUserTasks(userId)
                    }
                  ]
                }
              }
              break

            case 'getWorkspaceTaskOverview':
              result = {
                content: [
                  {
                    type: 'text',
                    text: await this.getWorkspaceTaskOverview()
                  }
                ]
              }
              break

            case 'getCurrentJapanTime':
              result = {
                content: [
                  {
                    type: 'text',
                    text: await this.getCurrentJapanTime()
                  }
                ]
              }
              break

            case 'testScheduledTask':
              // ScheduledControllerのモックを作成
              const mockController = {
                scheduledTime: Date.now(),
                cron: '0 9 * * 1-5'
              } as ScheduledController
              
              await this.scheduled(mockController)
              result = {
                content: [
                  {
                    type: 'text',
                    text: 'scheduled関数が正常に実行されました。Slackチャンネルを確認してください。'
                  }
                ]
              }
              break

            default:
              return this.createErrorResponse(mcpRequest.id, -32601, `Unknown tool: ${toolName}`)
          }
          break

        default:
          return this.createErrorResponse(mcpRequest.id, -32601, `Unknown method: ${mcpRequest.method}`)
      }

      const response: MCPResponse = {
        jsonrpc: '2.0',
        id: mcpRequest.id,
        result
      }

      return new Response(JSON.stringify(response), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      })

    } catch (error) {
      console.error('MCP Server Error:', error)
      return new Response(JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32603,
          message: 'Internal error'
        }
      }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      })
    }
  }

  private createErrorResponse(id: number | string, code: number, message: string): Response {
    const response: MCPResponse = {
      jsonrpc: '2.0',
      id,
      error: { code, message }
    }

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    })
  }

  /**
   * タスクメッセージの自動転送処理
   */
  private async handleTaskMessage(text: string, channel: string, userId: string, messageTs: string): Promise<void> {
    // ファイル編集コマンドをチェック
    const editResult = await this.handleFileEditCommands(text, channel, userId, messageTs)
    if (editResult) {
      return // ファイル編集コマンドが処理された場合は終了
    }

    // タスクパターンの正規表現
    const taskPatterns = [
      /\[タスク\]/i,
      /\[本日のタスク\]/i,
      /\[今日のタスク\]/i,
      /\[task\]/i,
      /\[todo\]/i,
      /\[やること\]/i
    ]
    
    // タスクパターンをチェック
    const isTaskMessage = taskPatterns.some(pattern => pattern.test(text))
    
    console.log('🔍 Task pattern check:', {
      text: text.substring(0, 100) + '...',
      isTaskMessage,
      channel: channel,
      patterns: taskPatterns.map(p => p.toString())
    })
    
    if (!isTaskMessage) {
      console.log('❌ Not a task message, skipping...')
      return
    }
    
    console.log('✅ Task message detected, processing...')
    
    // #generalチャンネルでのタスクメッセージは転送処理をスキップ（GitHubには保存）
    const isGeneralChannel = channel === 'C02TJS8D205'
    const isTaskChannel = channel === 'C091H8NUJ8L'
    
    console.log('📍 Channel analysis:', {
      channel,
      isGeneralChannel,
      isTaskChannel,
      channelName: this.getChannelNameFromId(channel)
    })

    try {
      // ユーザー情報を取得
      const userName = await this.getUserNameById(userId) || 'Unknown User'
      console.log('👤 User identified:', userName)
      
      // GitHubファイルに保存（全チャンネル共通）
      let saveResult = ''
      try {
        console.log('💾 Saving to GitHub...')
        saveResult = await this.saveTaskToGitHub(userName, text, messageTs)
        console.log('✅ GitHub save result:', saveResult)
      } catch (error) {
        console.error('❌ Error saving to GitHub:', error)
        saveResult = '⚠️ GitHub保存エラー'
      }
      
      // #タスクチャンネルからのメッセージのみ#generalに転送
      if (isTaskChannel) {
        const channelName = this.getChannelNameFromId(channel)
        const forwardMessage = `📋 *${userName}さんのタスク* (#${channelName}より自動転送)\n\n${text}\n\n${saveResult}`
        
        console.log('📤 Forwarding message to #general...')
        await this.postTaskForwardMessage(forwardMessage, channel, messageTs)
      } else if (isGeneralChannel) {
        console.log('⚠️ General channel task message - GitHub save only, no forwarding')
      } else {
        console.log('📍 Other channel task message - processing normally')
        const channelName = this.getChannelNameFromId(channel)
        const forwardMessage = `📋 *${userName}さんのタスク* (#${channelName}より自動転送)\n\n${text}\n\n${saveResult}`
        await this.postTaskForwardMessage(forwardMessage, channel, messageTs)
      }
      
      // 元のメッセージにリアクションを追加
      await this.addReaction(channel, messageTs, 'white_check_mark')
      
      console.log(`✅ Task message processed: channel=${channel}, user=${userName}, saved=${!!saveResult}`)
    } catch (error) {
      console.error('❌ Error handling task message:', error)
    }
  }

  /**
   * ファイル編集コマンドを処理
   */
  private async handleFileEditCommands(text: string, channel: string, userId: string, messageTs: string): Promise<boolean> {
    const editPatterns = [
      // [編集] ファイル名 内容
      /\[編集\]\s*(.+?\.md)\s+([\s\S]+)/i,
      // [追加] ファイル名 内容
      /\[追加\]\s*(.+?\.md)\s+([\s\S]+)/i,
      // [削除] ファイル名 行番号
      /\[削除\]\s*(.+?\.md)\s+(\d+)/i,
      // [表示] ファイル名
      /\[表示\]\s*(.+?\.md)/i,
      // [新規] ファイル名 内容
      /\[新規\]\s*(.+?\.md)\s+([\s\S]+)/i
    ]

    for (const pattern of editPatterns) {
      const match = text.match(pattern)
      if (match) {
        console.log('✅ File edit command detected:', match[0])
        
        try {
          const userName = await this.getUserNameById(userId) || 'Unknown User'
          let result = ''

          if (text.includes('[編集]')) {
            result = await this.editMarkdownFile(match[1], match[2], userName)
          } else if (text.includes('[追加]')) {
            result = await this.appendToMarkdownFile(match[1], match[2], userName)
          } else if (text.includes('[削除]')) {
            result = await this.deleteLineFromMarkdownFile(match[1], parseInt(match[2]), userName)
          } else if (text.includes('[表示]')) {
            result = await this.viewMarkdownFile(match[1])
          } else if (text.includes('[新規]')) {
            result = await this.createMarkdownFile(match[1], match[2], userName)
          }

          // 結果をSlackに投稿
          await this.postMessage(channel, result, messageTs)
          
          // 元のメッセージにリアクションを追加
          await this.addReaction(channel, messageTs, 'memo')
          
          return true
        } catch (error) {
          console.error('❌ Error handling file edit command:', error)
          await this.postMessage(channel, `❌ ファイル編集エラー: ${error instanceof Error ? error.message : 'Unknown error'}`, messageTs)
          return true
        }
      }
    }

    return false
  }

  /**
   * Markdownファイルを編集（完全置換）
   */
  private async editMarkdownFile(fileName: string, content: string, userName: string): Promise<string> {
    if (!this.env.GITHUB_TOKEN || !this.env.GITHUB_REPO || !this.env.GITHUB_OWNER) {
      return '❌ GitHub連携が設定されていません'
    }

    try {
      const filePath = this.normalizeFilePath(fileName)
      const timestamp = Date.now()
      const dateTime = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })

      // 既存ファイルを取得
      let fileSha = ''
      try {
        const response = await fetch(
          `https://api.github.com/repos/${this.env.GITHUB_OWNER}/${this.env.GITHUB_REPO}/contents/${encodeURIComponent(filePath)}?t=${timestamp}`,
          {
            headers: {
              'Authorization': `Bearer ${this.env.GITHUB_TOKEN}`,
              'Accept': 'application/vnd.github.v3+json',
              'User-Agent': 'NOROSHI-MCP-Server',
              'Cache-Control': 'no-cache'
            }
          }
        )

        if (response.ok) {
          const fileData = await response.json() as { sha: string }
          fileSha = fileData.sha
        }
      } catch (error) {
        // ファイルが存在しない場合は新規作成
      }

      // ファイルを更新
      const updateResponse = await fetch(
        `https://api.github.com/repos/${this.env.GITHUB_OWNER}/${this.env.GITHUB_REPO}/contents/${encodeURIComponent(filePath)}`,
        {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${this.env.GITHUB_TOKEN}`,
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'NOROSHI-MCP-Server',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            message: `📝 ${userName}によるファイル編集: ${fileName} (${dateTime})`,
            content: this.encodeBase64(content),
            sha: fileSha || undefined
          })
        }
      )

      if (!updateResponse.ok) {
        throw new Error(`GitHub API error: ${updateResponse.status}`)
      }

      return `✅ **ファイル編集完了**\n📄 ファイル: \`${fileName}\`\n👤 編集者: ${userName}\n⏰ 時刻: ${dateTime}\n\n💡 *ファイル全体が新しい内容で置換されました*`
    } catch (error) {
      console.error('Error editing markdown file:', error)
      return `❌ ファイル編集エラー: ${error instanceof Error ? error.message : 'Unknown error'}`
    }
  }

  /**
   * Markdownファイルに内容を追加
   */
  private async appendToMarkdownFile(fileName: string, content: string, userName: string): Promise<string> {
    if (!this.env.GITHUB_TOKEN || !this.env.GITHUB_REPO || !this.env.GITHUB_OWNER) {
      return '❌ GitHub連携が設定されていません'
    }

    try {
      const filePath = this.normalizeFilePath(fileName)
      const timestamp = Date.now()
      const dateTime = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })

      // 既存ファイルを取得
      let existingContent = ''
      let fileSha = ''
      
      try {
        const response = await fetch(
          `https://api.github.com/repos/${this.env.GITHUB_OWNER}/${this.env.GITHUB_REPO}/contents/${encodeURIComponent(filePath)}?t=${timestamp}`,
          {
            headers: {
              'Authorization': `Bearer ${this.env.GITHUB_TOKEN}`,
              'Accept': 'application/vnd.github.v3+json',
              'User-Agent': 'NOROSHI-MCP-Server',
              'Cache-Control': 'no-cache'
            }
          }
        )

        if (response.ok) {
          const fileData = await response.json() as { content: string, sha: string }
          existingContent = this.decodeBase64(fileData.content)
          fileSha = fileData.sha
        }
      } catch (error) {
        // ファイルが存在しない場合は新規作成
      }

      // 内容を追加
      const newContent = existingContent + (existingContent ? '\n\n' : '') + `## ${userName} - ${dateTime}\n\n${content}`

      // ファイルを更新
      const updateResponse = await fetch(
        `https://api.github.com/repos/${this.env.GITHUB_OWNER}/${this.env.GITHUB_REPO}/contents/${encodeURIComponent(filePath)}`,
        {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${this.env.GITHUB_TOKEN}`,
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'NOROSHI-MCP-Server',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            message: `➕ ${userName}によるファイル追記: ${fileName} (${dateTime})`,
            content: this.encodeBase64(newContent),
            sha: fileSha || undefined
          })
        }
      )

      if (!updateResponse.ok) {
        throw new Error(`GitHub API error: ${updateResponse.status}`)
      }

      return `✅ **ファイル追記完了**\n📄 ファイル: \`${fileName}\`\n👤 追記者: ${userName}\n⏰ 時刻: ${dateTime}\n\n💡 *内容がファイル末尾に追加されました*`
    } catch (error) {
      console.error('Error appending to markdown file:', error)
      return `❌ ファイル追記エラー: ${error instanceof Error ? error.message : 'Unknown error'}`
    }
  }

  /**
   * Markdownファイルから指定行を削除
   */
  private async deleteLineFromMarkdownFile(fileName: string, lineNumber: number, userName: string): Promise<string> {
    if (!this.env.GITHUB_TOKEN || !this.env.GITHUB_REPO || !this.env.GITHUB_OWNER) {
      return '❌ GitHub連携が設定されていません'
    }

    try {
      const filePath = this.normalizeFilePath(fileName)
      const timestamp = Date.now()
      const dateTime = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })

      // 既存ファイルを取得
      const response = await fetch(
        `https://api.github.com/repos/${this.env.GITHUB_OWNER}/${this.env.GITHUB_REPO}/contents/${encodeURIComponent(filePath)}?t=${timestamp}`,
        {
          headers: {
            'Authorization': `Bearer ${this.env.GITHUB_TOKEN}`,
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'NOROSHI-MCP-Server',
            'Cache-Control': 'no-cache'
          }
        }
      )

      if (!response.ok) {
        return `❌ ファイル \`${fileName}\` が見つかりません`
      }

      const fileData = await response.json() as { content: string, sha: string }
      const existingContent = this.decodeBase64(fileData.content)
      const lines = existingContent.split('\n')

      if (lineNumber < 1 || lineNumber > lines.length) {
        return `❌ 行番号 ${lineNumber} は範囲外です（1-${lines.length}）`
      }

      // 指定行を削除
      const deletedLine = lines[lineNumber - 1]
      lines.splice(lineNumber - 1, 1)
      const newContent = lines.join('\n')

      // ファイルを更新
      const updateResponse = await fetch(
        `https://api.github.com/repos/${this.env.GITHUB_OWNER}/${this.env.GITHUB_REPO}/contents/${encodeURIComponent(filePath)}`,
        {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${this.env.GITHUB_TOKEN}`,
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'NOROSHI-MCP-Server',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            message: `🗑️ ${userName}による行削除: ${fileName} L${lineNumber} (${dateTime})`,
            content: this.encodeBase64(newContent),
            sha: fileData.sha
          })
        }
      )

      if (!updateResponse.ok) {
        throw new Error(`GitHub API error: ${updateResponse.status}`)
      }

      return `✅ **行削除完了**\n📄 ファイル: \`${fileName}\`\n🗑️ 削除行: ${lineNumber}\n📝 削除内容: \`${deletedLine.substring(0, 100)}${deletedLine.length > 100 ? '...' : ''}\`\n👤 削除者: ${userName}\n⏰ 時刻: ${dateTime}`
    } catch (error) {
      console.error('Error deleting line from markdown file:', error)
      return `❌ 行削除エラー: ${error instanceof Error ? error.message : 'Unknown error'}`
    }
  }

  /**
   * Markdownファイルの内容を表示
   */
  private async viewMarkdownFile(fileName: string): Promise<string> {
    if (!this.env.GITHUB_TOKEN || !this.env.GITHUB_REPO || !this.env.GITHUB_OWNER) {
      return '❌ GitHub連携が設定されていません'
    }

    try {
      const filePath = this.normalizeFilePath(fileName)
      const timestamp = Date.now()

      const response = await fetch(
        `https://api.github.com/repos/${this.env.GITHUB_OWNER}/${this.env.GITHUB_REPO}/contents/${encodeURIComponent(filePath)}?t=${timestamp}`,
        {
          headers: {
            'Authorization': `Bearer ${this.env.GITHUB_TOKEN}`,
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'NOROSHI-MCP-Server',
            'Cache-Control': 'no-cache'
          }
        }
      )

      if (!response.ok) {
        return `❌ ファイル \`${fileName}\` が見つかりません`
      }

      const fileData = await response.json() as { content: string, size: number }
      const content = this.decodeBase64(fileData.content)
      const lines = content.split('\n')

      let result = `📄 **ファイル表示: ${fileName}**\n\n`
      result += `📊 **ファイル情報**\n`
      result += `・サイズ: ${fileData.size} bytes\n`
      result += `・行数: ${lines.length} 行\n\n`
      
      result += `📝 **内容**\n\`\`\`\n`
      
      // 内容が長すぎる場合は最初の50行のみ表示
      if (lines.length > 50) {
        result += lines.slice(0, 50).map((line, index) => `${index + 1}: ${line}`).join('\n')
        result += `\n... (${lines.length - 50}行省略)`
      } else {
        result += lines.map((line, index) => `${index + 1}: ${line}`).join('\n')
      }
      
      result += `\n\`\`\``

      return result
    } catch (error) {
      console.error('Error viewing markdown file:', error)
      return `❌ ファイル表示エラー: ${error instanceof Error ? error.message : 'Unknown error'}`
    }
  }

  /**
   * 新しいMarkdownファイルを作成
   */
  private async createMarkdownFile(fileName: string, content: string, userName: string): Promise<string> {
    if (!this.env.GITHUB_TOKEN || !this.env.GITHUB_REPO || !this.env.GITHUB_OWNER) {
      return '❌ GitHub連携が設定されていません'
    }

    try {
      const filePath = this.normalizeFilePath(fileName)
      const dateTime = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })

      // ファイルが既に存在するかチェック
      try {
        const checkResponse = await fetch(
          `https://api.github.com/repos/${this.env.GITHUB_OWNER}/${this.env.GITHUB_REPO}/contents/${encodeURIComponent(filePath)}`,
          {
            headers: {
              'Authorization': `Bearer ${this.env.GITHUB_TOKEN}`,
              'Accept': 'application/vnd.github.v3+json',
              'User-Agent': 'NOROSHI-MCP-Server'
            }
          }
        )

        if (checkResponse.ok) {
          return `❌ ファイル \`${fileName}\` は既に存在します。[編集]コマンドを使用してください。`
        }
      } catch (error) {
        // ファイルが存在しない場合は続行
      }

      // ヘッダー付きの内容を作成
      const fileContent = `# ${fileName.replace('.md', '')}\n\n作成者: ${userName}\n作成日時: ${dateTime}\n\n---\n\n${content}`

      // ファイルを作成
      const createResponse = await fetch(
        `https://api.github.com/repos/${this.env.GITHUB_OWNER}/${this.env.GITHUB_REPO}/contents/${encodeURIComponent(filePath)}`,
        {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${this.env.GITHUB_TOKEN}`,
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'NOROSHI-MCP-Server',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            message: `🆕 ${userName}による新規ファイル作成: ${fileName} (${dateTime})`,
            content: this.encodeBase64(fileContent)
          })
        }
      )

      if (!createResponse.ok) {
        throw new Error(`GitHub API error: ${createResponse.status}`)
      }

      return `✅ **新規ファイル作成完了**\n📄 ファイル: \`${fileName}\`\n👤 作成者: ${userName}\n⏰ 時刻: ${dateTime}\n\n💡 *ファイルがGitHubに作成されました*`
    } catch (error) {
      console.error('Error creating markdown file:', error)
      return `❌ ファイル作成エラー: ${error instanceof Error ? error.message : 'Unknown error'}`
    }
  }

  /**
   * ファイルパスを正規化
   */
  private normalizeFilePath(fileName: string): string {
    // .mdが付いていない場合は追加
    if (!fileName.endsWith('.md')) {
      fileName += '.md'
    }
    
    // パスの正規化（危険な文字を除去）
    fileName = fileName.replace(/[<>:"|?*]/g, '_')
    
    // 相対パスやディレクトリトラバーサルを防ぐ
    fileName = fileName.replace(/\.\./g, '_')
    
    return fileName
  }

  /**
   * タスク転送メッセージを投稿
   */
  private async postTaskForwardMessage(message: string, originalChannel: string, originalTs: string): Promise<void> {
    try {
      const blocks = [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: message
          }
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `🤖 自動転送 | 元メッセージ: <#${originalChannel}> | ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`
            }
          ]
        }
      ]

      await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.env.SLACK_BOT_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          channel: 'C02TJS8D205', // #general channel ID
          text: message,
          blocks: blocks
        })
      })
    } catch (error) {
      console.error('Error posting task forward message:', error)
    }
  }

  /**
   * メッセージにリアクションを追加
   */
  private async addReaction(channel: string, timestamp: string, reactionName: string): Promise<void> {
    try {
      await fetch('https://slack.com/api/reactions.add', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.env.SLACK_BOT_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          channel: channel,
          timestamp: timestamp,
          name: reactionName
        })
      })
    } catch (error) {
      console.error('Error adding reaction:', error)
    }
  }

  /**
   * UTF-8対応のBase64エンコード関数
   */
  private encodeBase64(input: string): string {
    // UTF-8文字列をUint8Arrayに変換
    const encoder = new TextEncoder()
    const uint8Array = encoder.encode(input)
    
    // Uint8ArrayをBase64文字列に変換
    let binary = ''
    for (let i = 0; i < uint8Array.length; i++) {
      binary += String.fromCharCode(uint8Array[i])
    }
    
    return btoa(binary)
  }

  /**
   * UTF-8対応のBase64デコード関数
   */
  private decodeBase64(input: string): string {
    try {
      // Base64文字列をバイナリに変換
      const binaryString = atob(input)
      
      // バイナリ文字列をUint8Arrayに変換
      const uint8Array = new Uint8Array(binaryString.length)
      for (let i = 0; i < binaryString.length; i++) {
        uint8Array[i] = binaryString.charCodeAt(i)
      }
      
      // Uint8ArrayをUTF-8文字列にデコード
      const decoder = new TextDecoder('utf-8')
      return decoder.decode(uint8Array)
    } catch (error) {
      console.error('Error decoding base64:', error)
      return ''
    }
  }

  /**
   * タスクをGitHubファイルに保存
   */
  private async saveTaskToGitHub(userName: string, messageText: string, timestamp: string): Promise<string> {
    if (!this.env.GITHUB_TOKEN || !this.env.GITHUB_REPO || !this.env.GITHUB_OWNER) {
      return '💡 *GitHub連携未設定*'
    }

    try {
      const now = new Date(parseFloat(timestamp) * 1000)
      const today = now.toISOString().split('T')[0] // YYYY-MM-DD
      const dateTime = now.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })
      const fileName = `${today}-tasks.md`
      const filePath = `タスク/${fileName}`

      // 新しいタスクリストを解析
      const newTasks = this.parseTaskList(messageText)
      
      // 既存ファイルを取得
      let existingContent = ''
      let fileSha = ''
      
      try {
        // キャッシュバスター用のタイムスタンプ
        const cacheTimestamp = Date.now()
        
        const response = await fetch(
          `https://api.github.com/repos/${this.env.GITHUB_OWNER}/${this.env.GITHUB_REPO}/contents/${encodeURIComponent(filePath)}?t=${cacheTimestamp}`,
          {
            headers: {
              'Authorization': `Bearer ${this.env.GITHUB_TOKEN}`,
              'Accept': 'application/vnd.github.v3+json',
              'User-Agent': 'NOROSHI-MCP-Server',
              'Cache-Control': 'no-cache'
            }
          }
        )

        if (response.ok) {
          const fileData = await response.json() as { content: string, sha: string }
          existingContent = this.decodeBase64(fileData.content)
          fileSha = fileData.sha
        }
      } catch (error) {
        // ファイルが存在しない場合は新規作成
      }

      // 既存のユーザータスクを取得
      const previousTasks = this.getUserPreviousTasksFromContent(userName, existingContent)
      
      // タスクの差分を計算
      const diff = this.calculateTaskDiff(previousTasks, newTasks)
      
      // 新しいコンテンツを生成
      const newContent = this.generateUpdatedTaskContent(existingContent, userName, newTasks, diff, dateTime, today)
      
      // GitHubにファイルを更新/作成
      const updateResponse = await fetch(
        `https://api.github.com/repos/${this.env.GITHUB_OWNER}/${this.env.GITHUB_REPO}/contents/${encodeURIComponent(filePath)}`,
        {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${this.env.GITHUB_TOKEN}`,
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'NOROSHI-MCP-Server',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            message: `📋 ${userName}のタスク更新 (${dateTime})`,
            content: this.encodeBase64(newContent),
            sha: fileSha || undefined
          })
        }
      )

      if (!updateResponse.ok) {
        throw new Error(`GitHub API error: ${updateResponse.status}`)
      }

      // 差分情報を生成
      let changeInfo = ''
      if (diff.added.length > 0 || diff.removed.length > 0) {
        changeInfo = `📊 *変更内容:*`
        if (diff.added.length > 0) {
          changeInfo += ` 🆕追加${diff.added.length}件`
        }
        if (diff.removed.length > 0) {
          changeInfo += ` 🗑️削除${diff.removed.length}件`
        }
        if (diff.unchanged.length > 0) {
          changeInfo += ` 🔄継続${diff.unchanged.length}件`
        }
      } else {
        changeInfo = '📊 *変更内容:* 新規登録'
      }

      return `✅ *GitHub保存完了* | ${changeInfo}\n📄 ファイル: \`${fileName}\``
    } catch (error) {
      console.error('Error saving to GitHub:', error)
      return `❌ *GitHub保存エラー*: ${error instanceof Error ? error.message : 'Unknown error'}`
    }
  }

  /**
   * タスクリストを解析（箇条書きを配列に変換）
   */
  private parseTaskList(messageText: string): string[] {
    const lines = messageText.split('\n')
    const tasks: string[] = []
    
    for (const line of lines) {
      const trimmed = line.trim()
      // 箇条書きパターンを検出: ・、-、*、1.、2.など
      if (trimmed.match(/^[・\-\*]/) || trimmed.match(/^\d+\./) || trimmed.match(/^[\-\+\*]\s/)) {
        const taskText = trimmed.replace(/^[・\-\*\d\.]+\s*/, '').trim()
        if (taskText) {
          tasks.push(taskText)
        }
      }
    }
    
    return tasks
  }

  /**
   * 既存コンテンツからユーザーの前回タスクを取得
   */
  private getUserPreviousTasksFromContent(userName: string, content: string): string[] {
    if (!content) return []
    
    const userSectionRegex = new RegExp(`## ${userName}([\\s\\S]*?)(?=## |$)`, 'g')
    const matches = [...content.matchAll(userSectionRegex)]
    
    if (matches.length === 0) return []
    
    // 最新のタスクセクションを取得
    const latestSection = matches[matches.length - 1][1]
    const tasks: string[] = []
    
    const lines = latestSection.split('\n')
    let inCurrentTasks = false
    
    for (const line of lines) {
      const trimmed = line.trim()
      
      // 現在のタスクセクションを探す
      if (trimmed === '**現在のタスク:**') {
        inCurrentTasks = true
        continue
      }
      
      // 他のセクションに入ったら終了
      if (trimmed.startsWith('**') && inCurrentTasks) {
        break
      }
      
      // 現在のタスクセクション内の箇条書きを取得
      if (inCurrentTasks && (trimmed.match(/^[・\-\*]/) || trimmed.match(/^\d+\./) || trimmed.match(/^[\-\+\*]\s/))) {
        const taskText = trimmed.replace(/^[・\-\*\d\.]+\s*/, '').trim()
        if (taskText) {
          tasks.push(taskText)
        }
      }
    }
    
    return tasks
  }

  /**
   * タスクの差分を計算
   */
  private calculateTaskDiff(previousTasks: string[], newTasks: string[]): {
    added: string[]
    removed: string[]
    unchanged: string[]
  } {
    const added = newTasks.filter(task => !previousTasks.includes(task))
    const removed = previousTasks.filter(task => !newTasks.includes(task))
    const unchanged = newTasks.filter(task => previousTasks.includes(task))
    
    return { added, removed, unchanged }
  }

  /**
   * 更新されたタスクコンテンツを生成
   */
  private generateUpdatedTaskContent(
    existingContent: string,
    userName: string,
    newTasks: string[],
    diff: { added: string[], removed: string[], unchanged: string[] },
    dateTime: string,
    today: string
  ): string {
    // 既存コンテンツがない場合は新規作成
    if (!existingContent) {
      existingContent = `# 📅 ${today} のタスク\n\n`
    }
    
    // 同じユーザーの既存エントリを削除
    const userSectionRegex = new RegExp(`## ${userName}[\\s\\S]*?(?=## |$)`, 'g')
    let updatedContent = existingContent.replace(userSectionRegex, '')
    
    // 新しいタスクエントリを作成
    let taskEntry = `## ${userName}\n\n`
    
    // 現在のタスク
    taskEntry += `**現在のタスク:**\n`
    newTasks.forEach(task => {
      taskEntry += `・${task}\n`
    })
    
    // 変更があった場合のみ差分情報を表示
    if (diff.added.length > 0 || diff.removed.length > 0) {
      taskEntry += `\n**最新の変更 (${dateTime}):**\n`
      
      if (diff.added.length > 0) {
        taskEntry += `🆕 追加:\n`
        diff.added.forEach(task => taskEntry += `・${task}\n`)
      }
      
      if (diff.removed.length > 0) {
        taskEntry += `🗑️ 削除:\n`
        diff.removed.forEach(task => taskEntry += `・${task}\n`)
      }
    }
    
    taskEntry += `\n---\n\n`
    
    return updatedContent + taskEntry
  }

  /**
   * チャンネルIDから名前を取得
   */
  private getChannelNameFromId(channelId: string): string {
    const channelMap: Record<string, string> = {
      'C02TJS8D205': 'general',
      'C02TMQRAS3D': 'random',
      'C091H8NUJ8L': 'タスク'
    }
    return channelMap[channelId] || channelId
  }
}
