import { WorkerEntrypoint } from 'cloudflare:workers'

interface Env {
  SLACK_BOT_TOKEN: string
  SLACK_APP_TOKEN: string
  SLACK_TEAM_ID: string
  SHARED_SECRET: string
  GITHUB_TOKEN?: string
  GITHUB_REPO?: string
  GITHUB_OWNER?: string
  NOTION_TOKEN?: string
  NOTION_DATABASE_ID?: string
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
  profile?: {
    display_name: string
  }
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

interface NotionPage {
  id: string
  title: string
  url: string
  content?: string
  lastEdited: string
}

interface NotionSearchResult {
  pages: NotionPage[]
  totalResults: number
  searchQuery: string
}

export default class NorosiTaskMCP extends WorkerEntrypoint<Env> {
  // 短期間キャッシュ（30秒）
  private taskCache: Map<string, { data: TaskFileData[], timestamp: number }> = new Map()
  private readonly CACHE_DURATION = 30 * 1000 // 30秒

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
   * 特定ユーザーのタスク状況を分析します（ユーザー名指定版）
   * @param userId {string} ユーザーID
   * @param userName {string} 既に取得済みのユーザー名
   * @returns {Promise<string>} タスク分析結果
   */
  async analyzeUserTasksWithUserName(userId: string, userName: string): Promise<string> {
    try {
      console.log(`[DEBUG] Analyzing tasks for user: ${userName} (ID: ${userId})`)
      
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
   * 特定ユーザーのタスク状況を分析します
   * @param userId {string} ユーザーID
   * @returns {Promise<string>} タスク分析結果
   */
  async analyzeUserTasks(userId: string): Promise<string> {
    try {
      const users = await this.getUsers()
      const user = users.find(u => u.id === userId)
      
      // タスク保存時と同じ優先順位でユーザー名を取得（統一性のため）
      const userName = user?.profile?.display_name || user?.real_name || user?.name || 'Unknown User'
      
      console.log(`[DEBUG] Analyzing tasks for user: ${userName} (ID: ${userId})`)
      
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

    // キャッシュチェック
    const cacheKey = `tasks_${userName}`
    const cached = this.taskCache.get(cacheKey)
    const now = Date.now()
    
    if (cached && (now - cached.timestamp) < this.CACHE_DURATION) {
      console.log(`[DEBUG] Using cached data for ${userName} (age: ${now - cached.timestamp}ms)`)
      return cached.data
    }

    try {
      // 最適化されたキャッシュバスター（過度に複雑にしない）
      const timestamp = Date.now()
      const random = Math.random().toString(36).substring(7)
      const cacheBuster = `${timestamp}_${random}`
      
      console.log(`[DEBUG] Fetching GitHub files with cache buster: ${cacheBuster}`)
      
      // タスクフォルダーの内容を取得
      const response = await fetch(
        `https://api.github.com/repos/${this.env.GITHUB_OWNER}/${this.env.GITHUB_REPO}/contents/タスク?t=${cacheBuster}`,
        {
          headers: {
            'Authorization': `Bearer ${this.env.GITHUB_TOKEN}`,
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'NOROSHI-MCP-Server',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache'
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

      // .mdファイルを優先順位付きで処理
      const mdFiles = files.filter(f => f.name.endsWith('.md') && f.type === 'file')
      
      // 優先順位: 1. tasks.md (汎用ファイル), 2. 日付順の古いファイル
      const prioritizedFiles = mdFiles.sort((a, b) => {
        // tasks.mdを最優先
        if (a.name === 'tasks.md') return -1
        if (b.name === 'tasks.md') return 1
        
        // その他は日付順（新しい順）
        return b.name.localeCompare(a.name)
      })
      
      console.log(`[DEBUG] File processing order:`, prioritizedFiles.map(f => f.name))

      for (const file of prioritizedFiles) {
        try {
          // ファイル内容取得時も最適化されたキャッシュバスター
          const fileTimestamp = Date.now()
          const fileRandom = Math.random().toString(36).substring(7)
          const fileCacheBuster = `${fileTimestamp}_${fileRandom}`
          
          const fileResponse = await fetch(`${file.download_url}?t=${fileCacheBuster}`, {
            headers: {
              'Cache-Control': 'no-cache, no-store, must-revalidate',
              'Pragma': 'no-cache'
            }
          })
          const content = await fileResponse.text()
          
          console.log(`[DEBUG] File ${file.name} content length: ${content.length} (cache buster: ${fileCacheBuster})`)
          
          // 各名前バリエーションで検索
          for (const nameVariation of nameVariations) {
            const parsedData = this.parseTaskFile(file.name, content, nameVariation)
          if (parsedData) {
              console.log(`[DEBUG] Found tasks for ${nameVariation} in ${file.name}: ${JSON.stringify(parsedData.users[0].tasks)}`)
            taskFiles.push(parsedData)
              break // 見つかったら他のバリエーションは試さない
            }
          }
          
          // tasks.mdでユーザーが見つかった場合は、それを最優先として他のファイルは無視
          if (file.name === 'tasks.md' && taskFiles.length > 0) {
            console.log(`[DEBUG] Found user in tasks.md, prioritizing this file over others`)
            break
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
        'C091H8NUJ8L': 'タスク',
        'C091P73EPGS': 'マニュアル'  // #マニュアルチャンネルID（仮）
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
    
    console.log(`[DEBUG] Task inquiry for user: ${userName} (ID: ${userId})`)
    
    // タスク分析を実行（既に取得済みのuserNameを渡す）
    const analysis = await this.analyzeUserTasksWithUserName(userId, userName)
    
    // 結果を投稿
    await this.postMessage(channel, analysis, messageTs)
  }

  /**
   * ユーザーIDから表示名へのマッピング
   */
  private getUserDisplayName(userId: string, slackUserName: string | null): string {
    // 特定のユーザーIDに対する固定の表示名マッピング
    const userDisplayMapping: Record<string, string> = {
      'U02TQ34K39S': '相原立弥',  // tatsu0823takasago -> 相原立弥
      // 他のユーザーマッピングもここに追加可能
    }
    
    // マッピングがある場合は固定の表示名を返す
    if (userDisplayMapping[userId]) {
      return userDisplayMapping[userId]
    }
    
    // マッピングがない場合はSlackから取得した名前を返す
    return slackUserName || 'Unknown User'
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
        return this.getUserDisplayName(userId, null)
      }

      // Slackから取得した名前（表示名 > 実名 > ユーザー名の優先順位）
      const slackUserName = data.user.profile?.display_name || data.user.real_name || data.user.name
      
      // 固定マッピングまたはSlack名を返す
      return this.getUserDisplayName(userId, slackUserName)
    } catch (error) {
      return this.getUserDisplayName(userId, null)
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
      if (hour === 23 && minute === 15) {
        reportType = '夜のタスク状況1'
        reportMessage = '🌃 **23:15 夜のタスク状況をお知らせします**'
      } else if (hour === 23 && minute === 25) {
        reportType = '夜のタスク状況2'
        reportMessage = '🌙 **23:25 夜のタスク進捗をお知らせします**'
      } else if (hour === 23 && minute === 35) {
        reportType = '夜のタスク状況3'
        reportMessage = '✨ **23:35 夜のタスク詳細をお知らせします**'
      } else if (hour === 23 && minute === 45) {
        reportType = '夜のタスク状況4'
        reportMessage = '🌟 **23:45 夜のタスク総括をお知らせします**'
      } else if (hour === 23 && minute === 55) {
        reportType = '夜のタスク状況5'
        reportMessage = '🌌 **23:55 本日最終タスク報告をお知らせします**'
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
      // 最適化されたキャッシュバスター（タスク照会機能と統一）
      const timestamp = Date.now()
      const random = Math.random().toString(36).substring(7)
      const cacheBuster = `${timestamp}_${random}`
      
      console.log(`[DEBUG] Auto-reminder fetching GitHub files with cache buster: ${cacheBuster}`)
      
      // タスクフォルダーの内容を取得
      const response = await fetch(
        `https://api.github.com/repos/${this.env.GITHUB_OWNER}/${this.env.GITHUB_REPO}/contents/タスク?t=${cacheBuster}`,
        {
          headers: {
            'Authorization': `Bearer ${this.env.GITHUB_TOKEN}`,
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'NOROSHI-MCP-Server',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache'
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

      // .mdファイルを優先順位付きで処理（タスク照会機能と統一）
      const mdFiles = files.filter(f => f.name.endsWith('.md') && f.type === 'file')
      
      // 優先順位: 1. tasks.md (汎用ファイル), 2. 日付順の古いファイル
      const prioritizedFiles = mdFiles.sort((a, b) => {
        // tasks.mdを最優先
        if (a.name === 'tasks.md') return -1
        if (b.name === 'tasks.md') return 1
        
        // その他は日付順（新しい順）
        return b.name.localeCompare(a.name)
      })
      
      console.log(`[DEBUG] Auto-reminder file processing order:`, prioritizedFiles.map(f => f.name))

      // 最優先ファイル（通常はtasks.md）のみを処理
      const priorityFile = prioritizedFiles[0]
      if (!priorityFile) {
        console.log(`[DEBUG] No markdown files found for auto-reminder`)
        return []
      }

      try {
        // ファイル内容取得時も最適化されたキャッシュバスター
        const fileTimestamp = Date.now()
        const fileRandom = Math.random().toString(36).substring(7)
        const fileCacheBuster = `${fileTimestamp}_${fileRandom}`
        
        const fileResponse = await fetch(`${priorityFile.download_url}?t=${fileCacheBuster}`, {
          headers: {
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache'
          }
        })
        const content = await fileResponse.text()
        
        console.log(`[DEBUG] Auto-reminder file ${priorityFile.name} content length: ${content.length} (cache buster: ${fileCacheBuster})`)
        
        const parsedData = this.parseAllUsersTaskFile(priorityFile.name, content)
        if (parsedData) {
          console.log(`[DEBUG] Auto-reminder found ${parsedData.users.length} users in ${priorityFile.name}`)
          return [parsedData]
        }
      } catch (error) {
        console.error(`Error reading file ${priorityFile.name}:`, error)
      }

      return []
    } catch (error) {
      console.error('Error fetching from GitHub for auto-reminder:', error)
      return []
    }
  }

  /**
   * タスクファイルから全ユーザーのデータを解析
   */
  private parseAllUsersTaskFile(fileName: string, content: string): TaskFileData | null {
    const lines = content.split('\n')
    // 汎用ファイル名の場合は現在日付を使用
    const date = fileName.match(/(\d{4}-\d{2}-\d{2})/)?.[1] || new Date().toISOString().split('T')[0]
    
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
        const targetChannels = ['C02TJS8D205', 'C091H8NUJ8L', 'C091P73EPGS'] // #general, #タスク, #マニュアル
        if (event.type === 'message' && targetChannels.includes(event.channel) && event.text) {
          console.log('✅ Target channel message detected:', {
            channel: event.channel,
            channelName: event.channel === 'C02TJS8D205' ? 'general' : 
                        event.channel === 'C091H8NUJ8L' ? 'タスク' : 
                        event.channel === 'C091P73EPGS' ? 'マニュアル' : 'unknown'
          })
          
          // ボット自身のメッセージは無視（無限ループ防止）
          // NOROSHI-AI bot (U091UQ2ATPB) のメッセージも無視
          if (event.user && !event.user.startsWith('B') && event.user !== 'U091UQ2ATPB') {
            console.log('✅ Human user message, processing...', {
              userId: event.user,
              channel: event.channel
            })
            
            // #マニュアルチャンネルでのマニュアル検索処理
            if (event.channel === 'C091P73EPGS') {
              await this.handleManualSearchRequest(event.text, event.channel, event.ts)
            } else {
              // タスクパターンの自動転送処理
              await this.handleTaskMessage(event.text, event.channel, event.user, event.ts)
              
              // タスク状況問い合わせ処理
              await this.handleTaskStatusInquiry(event.text, event.channel, event.ts)
            }
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
              },
              // 新しいファイル操作ツール
              {
                name: 'editFile',
                description: 'GitHubファイルを編集します（Cursor統合対応）',
                inputSchema: {
                  type: 'object',
                  properties: {
                    fileName: { type: 'string', description: 'ファイル名（.md拡張子）' },
                    content: { type: 'string', description: '新しいファイル内容' }
                  },
                  required: ['fileName', 'content']
                }
              },
              {
                name: 'appendToFile',
                description: 'GitHubファイルに内容を追加します',
                inputSchema: {
                  type: 'object',
                  properties: {
                    fileName: { type: 'string', description: 'ファイル名（.md拡張子）' },
                    content: { type: 'string', description: '追加する内容' }
                  },
                  required: ['fileName', 'content']
                }
              },
              {
                name: 'viewFile',
                description: 'GitHubファイルの内容を表示します',
                inputSchema: {
                  type: 'object',
                  properties: {
                    fileName: { type: 'string', description: 'ファイル名（.md拡張子）' }
                  },
                  required: ['fileName']
                }
              },
              {
                name: 'createFile',
                description: '新しいGitHubファイルを作成します',
                inputSchema: {
                  type: 'object',
                  properties: {
                    fileName: { type: 'string', description: 'ファイル名（.md拡張子）' },
                    content: { type: 'string', description: 'ファイル内容' }
                  },
                  required: ['fileName', 'content']
                }
              },
              {
                name: 'deleteLineFromFile',
                description: 'GitHubファイルから指定行を削除します',
                inputSchema: {
                  type: 'object',
                  properties: {
                    fileName: { type: 'string', description: 'ファイル名（.md拡張子）' },
                    lineNumber: { type: 'number', description: '削除する行番号' }
                  },
                  required: ['fileName', 'lineNumber']
                }
              },
              // Notion連携ツール
              {
                name: 'searchNotionManual',
                description: 'Notionからマニュアルページを検索します',
                inputSchema: {
                  type: 'object',
                  properties: {
                    query: { type: 'string', description: '検索クエリ（マニュアル名やキーワード）' }
                  },
                  required: ['query']
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

            // 新しいファイル操作ツールのハンドラー
            case 'editFile':
              result = {
                content: [
                  {
                    type: 'text',
                    text: await this.editMarkdownFile(args.fileName, args.content, 'MCP-User')
                  }
                ]
              }
              break

            case 'appendToFile':
              result = {
                content: [
                  {
                    type: 'text',
                    text: await this.appendToMarkdownFile(args.fileName, args.content, 'MCP-User')
                  }
                ]
              }
              break

            case 'viewFile':
              result = {
                content: [
                  {
                    type: 'text',
                    text: await this.viewMarkdownFile(args.fileName)
                  }
                ]
              }
              break

            case 'createFile':
              result = {
                content: [
                  {
                    type: 'text',
                    text: await this.createMarkdownFile(args.fileName, args.content, 'MCP-User')
                  }
                ]
              }
              break

            case 'deleteLineFromFile':
              result = {
                content: [
                  {
                    type: 'text',
                    text: await this.deleteLineFromMarkdownFile(args.fileName, args.lineNumber, 'MCP-User')
                  }
                ]
              }
              break

            // Notion検索ツールのハンドラー
            case 'searchNotionManual':
              result = {
                content: [
                  {
                    type: 'text',
                    text: await this.searchNotionManual(args.query)
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
      const dateTime = now.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })
      
      // より汎用的なファイル名を使用
      const fileName = `tasks.md`
      const filePath = `タスク/${fileName}`

      // 新しいタスクリストを解析
      const newTasks = this.parseTaskList(messageText)
      
      // 既存ファイルを取得
      let existingContent = ''
      let fileSha = ''
      
      try {
        // 最適化されたキャッシュバスター
        const cacheTimestamp = Date.now()
        const cacheRandom = Math.random().toString(36).substring(7)
        const cacheBuster = `${cacheTimestamp}_${cacheRandom}`
        
        const response = await fetch(
          `https://api.github.com/repos/${this.env.GITHUB_OWNER}/${this.env.GITHUB_REPO}/contents/${encodeURIComponent(filePath)}?t=${cacheBuster}`,
          {
            headers: {
              'Authorization': `Bearer ${this.env.GITHUB_TOKEN}`,
              'Accept': 'application/vnd.github.v3+json',
              'User-Agent': 'NOROSHI-MCP-Server',
              'Cache-Control': 'no-cache, no-store, must-revalidate',
              'Pragma': 'no-cache'
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
      
      // タスクを追加方式で処理（置換ではなく追加）
      const combinedTasks = [...previousTasks, ...newTasks]
      const uniqueTasks = [...new Set(combinedTasks)] // 重複除去
      
      // タスクの差分を計算
      const diff = {
        added: newTasks,
        removed: [] as string[],
        unchanged: previousTasks
      }
      
      // 新しいコンテンツを生成
      const newContent = this.generateUpdatedTaskContent(existingContent, userName, uniqueTasks, diff, dateTime, fileName)
      
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
            message: `📋 ${userName}のタスク追加 (${dateTime})`,
            content: this.encodeBase64(newContent),
            sha: fileSha || undefined
          })
        }
      )

      if (!updateResponse.ok) {
        throw new Error(`GitHub API error: ${updateResponse.status}`)
      }

      // キャッシュを無効化（タスク保存後は最新データを取得するため）
      const cacheKey = `tasks_${userName}`
      this.taskCache.delete(cacheKey)
      console.log(`[DEBUG] Cache invalidated for ${userName} after task save`)

      // 差分情報を生成
      let changeInfo = ''
        if (diff.added.length > 0) {
        changeInfo = `📊 *変更内容:* 🆕追加${diff.added.length}件`
        if (diff.unchanged.length > 0) {
          changeInfo += ` 🔄継続${diff.unchanged.length}件`
        }
      } else {
        changeInfo = '📊 *変更内容:* 変更なし（重複タスク）'
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
    fileName: string
  ): string {
    // 既存コンテンツがない場合は新規作成
    if (!existingContent) {
      existingContent = `# 📋 タスク管理\n\n## NOROSHI-AI\n\n**現在のタスク:**\n\n---\n\n`
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
      'C091H8NUJ8L': 'タスク',
      'C091P73EPGS': 'マニュアル'  // #マニュアルチャンネルID（仮）
    }
    return channelMap[channelId] || channelId
  }

  /**
   * Notionからマニュアルページを検索します
   * @param query {string} 検索クエリ
   * @returns {Promise<string>} 検索結果
   */
  async searchNotionManual(query: string): Promise<string> {
    if (!this.env.NOTION_TOKEN || !this.env.NOTION_DATABASE_ID) {
      return '❌ Notion連携が設定されていません。NOTION_TOKENとNOTION_DATABASE_IDを設定してください。'
    }

    try {
      console.log(`[DEBUG] Searching Notion for: ${query}`)
      
      // Notion APIでデータベースを検索
      const response = await fetch(`https://api.notion.com/v1/databases/${this.env.NOTION_DATABASE_ID}/query`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.env.NOTION_TOKEN}`,
          'Content-Type': 'application/json',
          'Notion-Version': '2022-06-28'
        },
        body: JSON.stringify({
          filter: {
            or: [
              {
                property: 'Name',
                title: {
                  contains: query
                }
              },
              {
                property: 'Tags',
                multi_select: {
                  contains: query
                }
              }
            ]
          },
          sorts: [
            {
              property: 'Last edited time',
              direction: 'descending'
            }
          ],
          page_size: 5
        })
      })

      if (!response.ok) {
        throw new Error(`Notion API error: ${response.status} ${response.statusText}`)
      }

      const data = await response.json() as {
        results: Array<{
          id: string
          url: string
          properties: {
            Name: {
              title: Array<{ plain_text: string }>
            }
            Tags?: {
              multi_select: Array<{ name: string }>
            }
          }
          last_edited_time: string
        }>
      }

      if (data.results.length === 0) {
        return `📋 「${query}」に関するマニュアルが見つかりませんでした。\n\n💡 検索のヒント:\n・キーワードを変えて試してみてください\n・部分的な単語でも検索できます`
      }

      // 検索結果をフォーマット
      let result = `📚 **「${query}」のマニュアル検索結果**\n\n`
      result += `🔍 **見つかったページ**: ${data.results.length}件\n\n`

      for (let i = 0; i < data.results.length; i++) {
        const page = data.results[i]
        const title = page.properties.Name.title[0]?.plain_text || 'タイトルなし'
        const tags = page.properties.Tags?.multi_select.map(tag => tag.name).join(', ') || ''
        const lastEdited = new Date(page.last_edited_time).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })

        result += `## ${i + 1}. ${title}\n`
        result += `🔗 **リンク**: ${page.url}\n`
        if (tags) {
          result += `🏷️ **タグ**: ${tags}\n`
        }
        result += `📅 **最終更新**: ${lastEdited}\n\n`

        // ページの内容を取得（最初のページのみ詳細表示）
        if (i === 0) {
          try {
            const contentResult = await this.getNotionPageContent(page.id)
            if (contentResult) {
              result += `📄 **内容プレビュー**:\n${contentResult}\n\n`
            }
          } catch (error) {
            console.error('Error fetching page content:', error)
          }
        }
      }

      result += `\n💡 *データソース: Notion Database*`
      return result

    } catch (error) {
      console.error('Error searching Notion:', error)
      return `❌ Notion検索エラー: ${error instanceof Error ? error.message : 'Unknown error'}`
    }
  }

  /**
   * Notionページの内容を取得します
   * @param pageId {string} ページID
   * @returns {Promise<string|null>} ページ内容
   */
  private async getNotionPageContent(pageId: string): Promise<string | null> {
    if (!this.env.NOTION_TOKEN) return null

    try {
      const response = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.env.NOTION_TOKEN}`,
          'Notion-Version': '2022-06-28'
        }
      })

      if (!response.ok) {
        return null
      }

      const data = await response.json() as {
        results: Array<{
          type: string
          paragraph?: {
            rich_text: Array<{ plain_text: string }>
          }
          heading_1?: {
            rich_text: Array<{ plain_text: string }>
          }
          heading_2?: {
            rich_text: Array<{ plain_text: string }>
          }
          heading_3?: {
            rich_text: Array<{ plain_text: string }>
          }
          bulleted_list_item?: {
            rich_text: Array<{ plain_text: string }>
          }
          numbered_list_item?: {
            rich_text: Array<{ plain_text: string }>
          }
        }>
      }

      let content = ''
      let blockCount = 0
      const maxBlocks = 10 // プレビューは最初の10ブロックまで

      for (const block of data.results) {
        if (blockCount >= maxBlocks) break

        let text = ''
        if (block.paragraph) {
          text = block.paragraph.rich_text.map(t => t.plain_text).join('')
        } else if (block.heading_1) {
          text = '# ' + block.heading_1.rich_text.map(t => t.plain_text).join('')
        } else if (block.heading_2) {
          text = '## ' + block.heading_2.rich_text.map(t => t.plain_text).join('')
        } else if (block.heading_3) {
          text = '### ' + block.heading_3.rich_text.map(t => t.plain_text).join('')
        } else if (block.bulleted_list_item) {
          text = '• ' + block.bulleted_list_item.rich_text.map(t => t.plain_text).join('')
        } else if (block.numbered_list_item) {
          text = `${blockCount + 1}. ` + block.numbered_list_item.rich_text.map(t => t.plain_text).join('')
        }

        if (text.trim()) {
          content += text + '\n'
          blockCount++
        }
      }

      return content.trim() || null
    } catch (error) {
      console.error('Error fetching page content:', error)
      return null
    }
  }

  /**
   * マニュアル検索リクエストを処理
   */
  private async handleManualSearchRequest(text: string, channel: string, messageTs: string): Promise<void> {
    // マニュアル検索パターンの正規表現
    const manualPatterns = [
      /(.+?)のマニュアル/i,
      /(.+?)マニュアル/i,
      /マニュアル\s*(.+)/i,
      /manual\s*(.+)/i,
      /(.+?)\s*manual/i,
      /(.+?)の使い方/i,
      /(.+?)について教えて/i
    ]

    let searchQuery: string | null = null

    // パターンマッチングで検索クエリを抽出
    for (const pattern of manualPatterns) {
      const match = text.match(pattern)
      if (match) {
        searchQuery = match[1].trim()
        break
      }
    }

    if (!searchQuery || searchQuery.length < 2) {
      return // 検索クエリが短すぎる場合は無視
    }

    console.log(`[DEBUG] Manual search request: "${searchQuery}"`)

    try {
      // Notion検索を実行
      const searchResult = await this.searchNotionManual(searchQuery)
      
      // 結果をSlackに投稿
      await this.postMessage(channel, searchResult, messageTs)
      
      // 元のメッセージにリアクションを追加
      await this.addReaction(channel, messageTs, 'books')
      
      console.log(`✅ Manual search completed: query="${searchQuery}", channel=${channel}`)
    } catch (error) {
      console.error('❌ Error handling manual search:', error)
      await this.postMessage(channel, `❌ マニュアル検索中にエラーが発生しました: ${error instanceof Error ? error.message : 'Unknown error'}`, messageTs)
    }
  }
}
