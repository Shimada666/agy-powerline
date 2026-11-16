# agy-powerline

用于 Google Antigravity CLI（agy）的自定义状态栏，显示模型、上下文、配额与 Git 状态。单文件 JS，无需 npm 安装依赖。

## 安装

需要已安装 agy 和 Node.js 20+。以下命令适用于 macOS / Linux / WSL。

### 1. 下载脚本

```bash
mkdir -p "$HOME/.agy-powerline"
curl -fL https://raw.githubusercontent.com/Shimada666/agy-powerline/main/statusline.js \
  -o "$HOME/.agy-powerline/statusline.js"
node --check "$HOME/.agy-powerline/statusline.js"
```

### 2. 配置 agy

编辑 `~/.gemini/antigravity-cli/settings.json`，在已有 JSON 顶层添加或替换 `statusLine`，保留其他配置：

```json
{
  "statusLine": {
    "type": "command",
    "command": "node \"$HOME/.agy-powerline/statusline.js\"",
    "stack_with_default": true
  }
}
```

如 agy 找不到 `node`，用 `command -v node` 查到的绝对路径替换命令中的 `node`；脚本路径也可替换为绝对路径。

### 3. 重启 agy

退出并重新启动 agy，状态栏会随会话更新。无需单独启动后台服务。

## 自定义

没有配置文件时使用默认样式。可在上述 `command` 末尾添加参数，例如：

```text
node "$HOME/.agy-powerline/statusline.js" --preset compact --layout pills
```

支持 `--preset`、`--layout`、`--theme` 等渲染参数；也可使用 `~/.agy-powerline/statusline.config.json` 配置。已有配置可继续使用。本仓库只提供运行脚本，不包含上游的交互式配置器或 npm CLI。

## 更新与卸载

更新：重新执行下载脚本的命令，已有配置保留。

卸载：从 agy 的 `settings.json` 中删除 `statusLine` 配置，然后删除 `~/.agy-powerline/statusline.js`。

## 许可

基于 [wassim-azi/agy-powerline](https://github.com/wassim-azi/agy-powerline) 修改，采用 MIT 许可证。完整许可及原作者版权声明保留在 `statusline.js` 中。
