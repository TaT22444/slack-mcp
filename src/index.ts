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
      // タスクフォルダーの内容を取得
      const response = await fetch(
        `https://api.github.com/repos/${this.env.GITHUB_OWNER}/${this.env.GITHUB_REPO}/contents/タスク`,
        {
          headers: {
            'Authorization': `Bearer ${this.env.GITHUB_TOKEN}`,
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'NOROSHI-MCP-Server'
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
          const fileResponse = await fetch(file.download_url)
          const content = await fileResponse.text()
          const parsedData = this.parseTaskFile(file.name, content, userName)
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
   * タスクファイルの内容を解析
   */
  private parseTaskFile(fileName: string, content: string, targetUserName: string): TaskFileData | null {
    const lines = content.split('\n')
    const date = fileName.match(/(\d{4}-\d{2}-\d{2})/)?.[1] || ''
    
    let currentUser = ''
    let tasks: string[] = []
    let lastUpdated = ''
    let inTaskSection = false
    
    for (const line of lines) {
      // ユーザーセクションの検出
      if (line.startsWith('## ')) {
        if (currentUser === targetUserName && tasks.length > 0) {
          break // 対象ユーザーのセクションが終了
        }
        currentUser = line.replace('## ', '').trim()
        inTaskSection = false
        tasks = []
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
    
    if (currentUser === targetUserName && tasks.length > 0) {
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

      // 表示名 > 実名 > ユーザー名の優先順位で返す
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
        
        // #generalチャンネルのメッセージのみ処理
        if (event.type === 'message' && event.channel === 'C02TJS8D205' && event.text) {
          // ボット自身のメッセージは無視
          if (event.user && !event.user.startsWith('B')) {
            await this.handleTaskStatusInquiry(event.text, event.channel, event.ts)
          }
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
}
