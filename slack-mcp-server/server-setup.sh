#!/bin/bash

# NOROSHI タスクモニター VPSセットアップスクリプト
# Ubuntu 20.04/22.04 対応

echo "🚀 NOROSHI Task Monitor VPS Setup Starting..."

# システム更新
echo "📦 Updating system packages..."
sudo apt update && sudo apt upgrade -y

# Node.js 18.x インストール
echo "📦 Installing Node.js 18.x..."
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# PM2 インストール（プロセス管理）
echo "📦 Installing PM2..."
sudo npm install -g pm2

# Git インストール
echo "📦 Installing Git..."
sudo apt install -y git

# プロジェクトディレクトリ作成
echo "📁 Creating project directory..."
mkdir -p ~/noroshi-task-monitor
cd ~/noroshi-task-monitor

# GitHubからクローン（手動で設定）
echo "📥 Please clone your repository:"
echo "git clone https://github.com/your-username/NOROSHI.git"
echo "cd NOROSHI/slack-mcp-server"

# 依存関係インストール用コマンド表示
echo "📦 After cloning, run:"
echo "npm install"

# 環境変数設定ファイル作成
echo "🔧 Creating environment setup..."
cat > ~/setup-env.sh << 'EOF'
#!/bin/bash
echo "🔧 Setting up environment variables..."
echo "Please create .env file with:"
echo "SLACK_BOT_TOKEN=xoxb-your-token"
echo "SLACK_APP_TOKEN=xapp-your-token"
echo "SLACK_TEAM_ID=your-team-id"

# .env ファイル作成
cat > .env << 'ENVEOF'
SLACK_BOT_TOKEN=
SLACK_APP_TOKEN=
SLACK_TEAM_ID=
ENVEOF

echo "✅ .env file created. Please edit it with your tokens."
EOF

chmod +x ~/setup-env.sh

# PM2設定ファイル作成
echo "⚙️ Creating PM2 configuration..."
cat > ~/ecosystem.config.js << 'EOF'
module.exports = {
  apps: [{
    name: 'noroshi-task-monitor',
    script: './task-monitor-scheduled.js',
    cwd: './NOROSHI/slack-mcp-server',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production'
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true
  }]
};
EOF

# ログディレクトリ作成
mkdir -p ~/logs

# ファイアウォール設定（必要に応じて）
echo "🔒 Configuring firewall..."
sudo ufw allow ssh
sudo ufw allow 22
sudo ufw --force enable

# 自動起動設定用スクリプト
cat > ~/start-monitor.sh << 'EOF'
#!/bin/bash
cd ~/noroshi-task-monitor
pm2 start ecosystem.config.js
pm2 startup
pm2 save
EOF

chmod +x ~/start-monitor.sh

echo "✅ VPS Setup completed!"
echo ""
echo "🔧 Next steps:"
echo "1. Clone your repository: git clone https://github.com/your-username/NOROSHI.git"
echo "2. Install dependencies: cd NOROSHI/slack-mcp-server && npm install"
echo "3. Setup environment: ~/setup-env.sh"
echo "4. Edit .env file with your Slack tokens"
echo "5. Start the monitor: ~/start-monitor.sh"
echo ""
echo "📊 Useful commands:"
echo "pm2 status          - Check status"
echo "pm2 logs            - View logs"
echo "pm2 restart all     - Restart"
echo "pm2 stop all        - Stop"
echo "pm2 delete all      - Delete" 