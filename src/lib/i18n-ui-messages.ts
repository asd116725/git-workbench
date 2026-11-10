/** 应用界面文案；分支、路径、提交信息与文件内容始终保留原文。 */
export const uiMessages: Record<string, { en: string; 'zh-TW': string }> = {
  "调整项目 {name} 的顺序": { "en": "Reorder project {name}", "zh-TW": "調整專案 {name} 的順序" },
  "调整工作树 {name} 的顺序": { "en": "Reorder worktree {name}", "zh-TW": "調整工作樹 {name} 的順序" },
  "拖动排序，或按 ↑ / ↓ 调整": { "en": "Drag to reorder, or press ↑ / ↓", "zh-TW": "拖曳排序，或按 ↑ / ↓ 調整" },
  "已移至第 {position} 位": { "en": "Moved to position {position}", "zh-TW": "已移至第 {position} 位" },
  "排序保存失败，请重试。": { "en": "Could not save the order. Try again.", "zh-TW": "排序儲存失敗，請重試。" },
  "修改项目名称": { "en": "Rename project", "zh-TW": "修改專案名稱" },
  "修改主工作区名称": { "en": "Rename main worktree", "zh-TW": "修改主工作區名稱" },
  "修改工作树名称": { "en": "Rename worktree", "zh-TW": "修改工作樹名稱" },
  "修改本机显示名称，不改变目录或 Git 分支。": { "en": "Change the display name on this device without changing the directory or Git branch.", "zh-TW": "修改本機顯示名稱，不改變目錄或 Git 分支。" },
  "显示名称": { "en": "Display name", "zh-TW": "顯示名稱" },
  "名称不能为空": { "en": "Name cannot be empty", "zh-TW": "名稱不能為空" },
  "保存失败，请重试。": { "en": "Could not save. Try again.", "zh-TW": "儲存失敗，請重試。" },
  "默认名称：{name}": { "en": "Default name: {name}", "zh-TW": "預設名稱：{name}" },
  "恢复默认": { "en": "Reset name", "zh-TW": "恢復預設" },
  "保存": { "en": "Save", "zh-TW": "儲存" },
  "名称已更新": { "en": "Name updated", "zh-TW": "名稱已更新" },
  "已恢复默认名称": { "en": "Default name restored", "zh-TW": "已恢復預設名稱" },
  "主": { "en": "Main", "zh-TW": "主" },
  "撤销全部未暂存修改": {"en": "Discard all unstaged changes", "zh-TW": "撤銷全部未暫存修改"},
  "撤销未暂存修改 {path}": {"en": "Discard unstaged changes in {path}", "zh-TW": "撤銷未暫存修改 {path}"},
  "移到废纸篓 {path}": {"en": "Move {path} to Trash", "zh-TW": "移到垃圾桶 {path}"},
  "撤销未暂存修改？": {"en": "Discard unstaged changes?", "zh-TW": "撤銷未暫存修改？"},
  "撤销全部未暂存修改？": {"en": "Discard all unstaged changes?", "zh-TW": "撤銷全部未暫存修改？"},
  "移到废纸篓？": {"en": "Move to Trash?", "zh-TW": "移到垃圾桶？"},
  "移到废纸篓": {"en": "Move to Trash", "zh-TW": "移到垃圾桶"},
  "撤销修改": {"en": "Discard changes", "zh-TW": "撤銷修改"},
  "撤销 {count} 个文件": {"en": "Discard files ({count})", "zh-TW": "撤銷 {count} 個檔案"},
  "包含 {count} 个新增文件（移到废纸篓）": {"en": "Include new files: {count} (move to Trash)", "zh-TW": "包含 {count} 個新增檔案（移到垃圾桶）"},
  "未暂存内容将丢失，无法通过 Git 恢复。": {"en": "Unstaged changes will be lost and cannot be recovered with Git.", "zh-TW": "未暫存內容將遺失，無法透過 Git 復原。"},
  "新增文件将移到废纸篓。": {"en": "New files will be moved to Trash.", "zh-TW": "新增檔案將移到垃圾桶。"},
  "正在读取文件…": {"en": "Reading files…", "zh-TW": "正在讀取檔案…"},
  "待撤销文件": {"en": "Files to discard", "zh-TW": "待撤銷檔案"},
  "正在撤销…": {"en": "Discarding…", "zh-TW": "正在撤銷…"},
  "已撤销 {count} 个文件的未暂存修改": {"en": "Discarded unstaged changes in {count} files", "zh-TW": "已撤銷 {count} 個檔案的未暫存修改"},

  "外观主题": {"en": "Appearance", "zh-TW": "外觀主題"},
  "浅色": {"en": "Light", "zh-TW": "淺色"},
  "深色": {"en": "Dark", "zh-TW": "深色"},
  "跟随系统": {"en": "System", "zh-TW": "跟隨系統"},
  "明亮、清晰": {"en": "Bright and clear", "zh-TW": "明亮、清晰"},
  "熟悉的深色工作台": {"en": "The familiar dark workspace", "zh-TW": "熟悉的深色工作台"},
  "自动适配系统外观": {"en": "Match system appearance", "zh-TW": "自動配合系統外觀"},
  "随系统外观自动切换，当前为{theme}。": {"en": "Follow system appearance. Currently {theme}.", "zh-TW": "隨系統外觀自動切換，目前為{theme}。"},
  "切换立即生效，外观偏好会自动保存。": {"en": "Changes apply immediately and are saved automatically.", "zh-TW": "切換立即生效，外觀偏好會自動儲存。"},
  "调整外观与阅读体验，找到适合你的工作方式。": {"en": "Adjust appearance and reading preferences to suit your workflow.", "zh-TW": "調整外觀與閱讀體驗，找到適合你的工作方式。"},
  "切换主题时保留当前工作区、差异阅读位置和提交草稿。": {"en": "Switching themes preserves the current worktree, diff reading position, and commit draft.", "zh-TW": "切換主題時保留目前工作區、差異閱讀位置與提交草稿。"},
  "1 工作树": { "en": "1 worktree", "zh-TW": "1 工作樹" },
  "{count} 工作树": { "en": "{count} worktrees", "zh-TW": "{count} 工作樹" },
  "当前 · {count}": { "en": "Current · {count}", "zh-TW": "目前 · {count}" },
  "当前": { "en": "Current", "zh-TW": "目前" },
  "关联": { "en": "Linked", "zh-TW": "關聯" },
  "未检测到 API Key": {"en": "No API key detected", "zh-TW": "未偵測到 API Key"},
  "API Key 无效，请更新本机配置后重试。": {"en": "The API key is invalid. Update your local configuration and try again.", "zh-TW": "API Key 無效，請更新本機設定後重試。"},
  "DeepSeek 余额不足，请充值后重试。": {"en": "Your DeepSeek balance is insufficient. Add funds and try again.", "zh-TW": "DeepSeek 餘額不足，請儲值後重試。"},
  "请求过于频繁，请稍后重试。": {"en": "Too many requests. Try again later.", "zh-TW": "請求過於頻繁，請稍後重試。"},
  "无法连接 DeepSeek，请检查网络后重试。": {"en": "Cannot connect to DeepSeek. Check your connection and try again.", "zh-TW": "無法連線至 DeepSeek，請檢查網路後重試。"},
  "生成超时，请稍后重试。": {"en": "Generation timed out. Try again later.", "zh-TW": "產生逾時，請稍後重試。"},
  "DeepSeek 服务暂时不可用，请稍后重试。": {"en": "DeepSeek is temporarily unavailable. Try again later.", "zh-TW": "DeepSeek 服務暫時無法使用，請稍後重試。"},
  "请先完成当前 Git 操作或解决冲突，再使用 AI 生成。": {"en": "Complete the current Git operation or resolve conflicts before using AI.", "zh-TW": "請先完成目前的 Git 操作或解決衝突，再使用 AI 產生。"},
  "暂存内容超出生成上限，请缩小本次暂存范围后重试。": {"en": "The staged content exceeds the generation limit. Stage fewer changes and try again.", "zh-TW": "暫存內容超出產生上限，請縮小本次暫存範圍後重試。"},
  "暂存内容或当前提交已变化，请重新生成。": {"en": "The staged content or current commit has changed. Generate again.", "zh-TW": "暫存內容或目前提交已變更，請重新產生。"},
  "未获得完整有效的提交文案，请重试。": {"en": "No complete, valid commit message was returned. Try again.", "zh-TW": "未取得完整有效的提交文案，請重試。"},
  "生成文案未通过仓库规则校验，标题或不可拆分内容可能超限，请重新生成或手动调整。": {"en": "The generated message failed repository checks. The title or an unbreakable token may be too long. Generate again or edit manually.", "zh-TW": "生成文案未通過倉庫規則校驗，標題或不可拆分內容可能超限，請重新生成或手動調整。"},
  "仓库包含暂不支持自动校验的提交规则，请手动填写提交信息。": {"en": "This repository has commit rules that cannot be checked automatically yet. Enter the commit message manually.", "zh-TW": "倉庫包含暫不支援自動校驗的提交規則，請手動填寫提交資訊。"},
  "无法读取提交规范，请检查本机 Skill 文件后重试。": {"en": "Cannot read the commit guidelines. Check your local Skill file and try again.", "zh-TW": "無法讀取提交規範，請檢查本機 Skill 檔案後重試。"},
  "生成已取消，原草稿保持不变。": {"en": "Generation cancelled. Your draft is unchanged.", "zh-TW": "產生已取消，原草稿保持不變。"},
  "无法读取暂存内容，请刷新仓库后重试。": {"en": "Cannot read the staged content. Refresh the repository and try again.", "zh-TW": "無法讀取暫存內容，請重新整理儲存庫後重試。"},
  "生成失败，请稍后重试。": {"en": "Generation failed. Try again later.", "zh-TW": "產生失敗，請稍後重試。"},
  "请打开可用的本地工作区后使用 AI 生成。": {"en": "Open an available local worktree to use AI generation.", "zh-TW": "請開啟可用的本機工作區後使用 AI 產生。"},
  "AI 生成提交信息": {"en": "Generate commit message with AI", "zh-TW": "AI 產生提交訊息"},
  "根据暂存内容和当前界面语言生成文案，确认使用后才会填入提交框。": {"en": "Generate a message from staged changes in the current interface language. It is only added to your draft when you apply it.", "zh-TW": "根據暫存內容和目前介面語言產生文案，確認使用後才會填入提交框。"},
  "已暂存 {count} 个文件": {"en": "{count} staged files", "zh-TW": "已暫存 {count} 個檔案"},
  "生成模式": {"en": "Generation mode", "zh-TW": "產生模式"},
  "简洁": {"en": "Concise", "zh-TW": "簡潔"},
  "详细（Skill）": {"en": "Detailed (Skill)", "zh-TW": "詳細（Skill）"},
  "简短标题，必要时补充 1–3 条要点。": {"en": "A short title, with 1–3 bullets only when needed.", "zh-TW": "簡短標題，必要時補充 1–3 條要點。"},
  "按 Skill 生成概述和详细要点。": {"en": "Follow the Skill for an overview and detailed bullets.", "zh-TW": "依 Skill 產生概述和詳細要點。"},
  "切换模式后，点击“重新生成”更新文案。": {"en": "After switching modes, click “Generate again” to update the message.", "zh-TW": "切換模式後，點擊「重新產生」更新文案。"},
  "正在检测 API Key…": {"en": "Checking for an API key…", "zh-TW": "正在偵測 API Key…"},
  "正在生成提交文案…": {"en": "Generating commit message…", "zh-TW": "正在產生提交文案…"},
  "原草稿保持不变，可随时取消。": {"en": "Your draft is unchanged. You can cancel at any time.", "zh-TW": "原草稿保持不變，可隨時取消。"},
  "已检测到 API Key": {"en": "API key detected", "zh-TW": "已偵測到 API Key"},
  "可以开始生成；检测到配置不代表已通过服务鉴权。": {"en": "Ready to generate. Detecting a key does not verify service authentication.", "zh-TW": "可以開始產生；偵測到設定不代表已通過服務驗證。"},
  "请在本机登录 shell 中配置 DEEPSEEK_API_KEY，然后重新检测。": {"en": "Configure DEEPSEEK_API_KEY in your local login shell, then check again.", "zh-TW": "請在本機登入 shell 中設定 DEEPSEEK_API_KEY，然後重新偵測。"},
  "若仅在终端临时 export，请从该终端启动应用，或配置登录环境后重启应用。密钥不会在此显示。": {"en": "If you only exported it in a terminal, launch the app from that terminal, or configure your login environment and restart. The key is never displayed here.", "zh-TW": "若僅在終端機暫時 export，請從該終端機啟動應用程式，或設定登入環境後重新啟動。金鑰不會在此顯示。"},
  "原草稿保持不变。": {"en": "Your draft is unchanged.", "zh-TW": "原草稿保持不變。"},
  "生成结果": {"en": "Generated message", "zh-TW": "產生結果"},
  "生成依据：{count} 个暂存文件": {"en": "Based on {count} staged files", "zh-TW": "產生依據：{count} 個暫存檔案"},
  "草稿已发生变化。请核对后再次点击应用，确认替换当前草稿。": {"en": "Your draft has changed. Review it and apply again to confirm replacing the current draft.", "zh-TW": "草稿已變更。請核對後再次點擊套用，確認取代目前草稿。"},
  "已有手写草稿。只有点击“替换草稿”才会覆盖原内容。": {"en": "You have an existing draft. It is only overwritten when you click “Replace draft”.", "zh-TW": "已有手寫草稿。只有點擊「取代草稿」才會覆寫原內容。"},
  "确认使用后填入提交框，仍需检查并手动提交。": {"en": "Apply the message to your draft, then review and commit manually.", "zh-TW": "確認使用後填入提交框，仍需檢查並手動提交。"},
  "正在核验暂存内容…": {"en": "Validating staged content…", "zh-TW": "正在驗證暫存內容…"},
  "仅将暂存差异与必要提交规范发送至 DeepSeek。": {"en": "Only staged changes and required commit guidelines are sent to DeepSeek.", "zh-TW": "僅將暫存差異與必要提交規範傳送至 DeepSeek。"},
  "重新生成": {"en": "Generate again", "zh-TW": "重新產生"},
  "重试": {"en": "Retry", "zh-TW": "重試"},
  "取消生成": {"en": "Cancel generation", "zh-TW": "取消產生"},
  "替换草稿": {"en": "Replace draft", "zh-TW": "取代草稿"},
  "使用此文案": {"en": "Use this message", "zh-TW": "使用此文案"},
  "重新检测": {"en": "Check again", "zh-TW": "重新偵測"},
  "开始生成": {"en": "Generate", "zh-TW": "開始產生"},
  "已填入提交文案，请检查后提交。": {"en": "Message added to your draft. Review it before committing.", "zh-TW": "已填入提交文案，請檢查後提交。"},
  "AI 生成": {"en": "AI generate", "zh-TW": "AI 產生"},
  "将暂存差异和必要提交规范发送至 DeepSeek": {"en": "Send staged changes and required commit guidelines to DeepSeek", "zh-TW": "將暫存差異和必要提交規範傳送至 DeepSeek"},
  "待推送": { "en": "Unpushed", "zh-TW": "待推送" },
  "此提交尚未包含在上游 {upstream} 中；状态基于本地最近获取的引用。": { "en": "This commit is not yet in upstream {upstream}. Status uses the most recently fetched local refs.", "zh-TW": "此提交尚未包含在上游 {upstream} 中；狀態以本機最近擷取的引用為準。" },
  "未设置上游分支。": { "en": "No upstream branch is configured.", "zh-TW": "未設定上游分支。" },
  "尚未获得同步状态，请刷新或获取远程更新后重试。": { "en": "Sync status is unavailable. Refresh or fetch remote updates and try again.", "zh-TW": "尚未取得同步狀態，請重新整理或取得遠端更新後重試。" },
  "无法确定与上游 {upstream} 的提交差异；请先获取远程更新。": {
    "en": "Commit differences from upstream {upstream} are unavailable. Fetch remote updates first.",
    "zh-TW": "無法確定與上游 {upstream} 的提交差異；請先擷取遠端更新。"
  },
  "已与上游 {upstream} 同步。数量基于最近获取的引用。": {
    "en": "In sync with upstream {upstream}. Counts use the most recently fetched refs.",
    "zh-TW": "已與上游 {upstream} 同步。數量以最近擷取的引用為準。"
  },
  "相对上游 {upstream}：待拉取 {behind} 个提交，待推送 {ahead} 个提交。数量基于最近获取的引用。": {
    "en": "Compared with upstream {upstream}: commits to pull: {behind}; commits to push: {ahead}. Counts use the most recently fetched refs.",
    "zh-TW": "相對上游 {upstream}：待拉取 {behind} 個提交，待推送 {ahead} 個提交。數量以最近擷取的引用為準。"
  },
  "仓库根目录": {
    "en": "Repository root",
    "zh-TW": "儲存庫根目錄"
  },
  "仓库导航": {
    "en": "Repository navigation",
    "zh-TW": "儲存庫導覽"
  },
  "展开或收起仓库 {name}": {
    "en": "Expand or collapse repository {name}",
    "zh-TW": "展開或收合儲存庫 {name}"
  },
  "选择仓库 {name}": {
    "en": "Select repository {name}",
    "zh-TW": "選取儲存庫 {name}"
  },
  "仓库": {
    "en": "Repositories",
    "zh-TW": "儲存庫"
  },
  "打开仓库": {
    "en": "Open repository",
    "zh-TW": "開啟儲存庫"
  },
  "{value1} 个工作区": {
    "en": "Worktrees: {value1}",
    "zh-TW": "{value1} 個工作區"
  },
  "已锁定": {
    "en": "Locked",
    "zh-TW": "已鎖定"
  },
  "锁定：{value1}": {
    "en": "Locked: {value1}",
    "zh-TW": "鎖定：{value1}"
  },
  "可清理：{value1}": {
    "en": "Prunable: {value1}",
    "zh-TW": "可清理：{value1}"
  },
  "裸仓库": {
    "en": "Bare repository",
    "zh-TW": "裸儲存庫"
  },
  "目录不可用": {
    "en": "Directory unavailable",
    "zh-TW": "目錄無法使用"
  },
  "设置": {
    "en": "Settings",
    "zh-TW": "設定"
  },
  "本地更改": {
    "en": "Local changes",
    "zh-TW": "本機變更"
  },
  "提交历史": {
    "en": "History",
    "zh-TW": "提交歷史"
  },
  "管理分支：{value1}": {
    "en": "Manage branch: {value1}",
    "zh-TW": "管理分支：{value1}"
  },
  "查看、切换、创建或删除本地分支": {
    "en": "View, switch, create or delete local branches",
    "zh-TW": "檢視、切換、建立或刪除本機分支"
  },
  "将其他分支合并到 {value1}": {
    "en": "Merge another branch into {value1}",
    "zh-TW": "將其他分支合併至 {value1}"
  },
  "合并": {
    "en": "Merge",
    "zh-TW": "合併"
  },
  "刷新中": {
    "en": "Refreshing",
    "zh-TW": "重新整理中"
  },
  "刷新": {
    "en": "Refresh",
    "zh-TW": "重新整理"
  },
  "合并冲突": {
    "en": "Merge conflicts",
    "zh-TW": "合併衝突"
  },
  "未暂存": {
    "en": "Unstaged",
    "zh-TW": "未暫存"
  },
  "已暂存": {
    "en": "Staged",
    "zh-TW": "已暫存"
  },
  "暂存": {
    "en": "Stage",
    "zh-TW": "暫存"
  },
  "取消暂存": {
    "en": "Unstage",
    "zh-TW": "取消暫存"
  },
  "{value1}（{value2} 个文件）": {
    "en": "{value1} (files: {value2})",
    "zh-TW": "{value1}（{value2} 個檔案）"
  },
  "暂存已解决的冲突": {
    "en": "Stage resolved conflict",
    "zh-TW": "暫存已解決的衝突"
  },
  "暂存文件后即可提交": {
    "en": "Stage files to commit",
    "zh-TW": "暫存檔案後即可提交"
  },
  "工作区没有未暂存的更改": {
    "en": "No unstaged changes",
    "zh-TW": "工作區沒有未暫存的變更"
  },
  "合并提交信息": {
    "en": "Merge commit message",
    "zh-TW": "合併提交訊息"
  },
  "提交信息": {
    "en": "Commit message",
    "zh-TW": "提交訊息"
  },
  "简要说明这次更改\n\n添加详细说明（可选）": {
    "en": "Summarize your changes\n\nAdd a description (optional)",
    "zh-TW": "簡要說明這次變更\n\n新增詳細說明（選填）"
  },
  "正在处理…": {
    "en": "Working…",
    "zh-TW": "正在處理…"
  },
  "完成合并": {
    "en": "Complete merge",
    "zh-TW": "完成合併"
  },
  "提交 {value1} 个文件": {
    "en": "Commit files ({value1})",
    "zh-TW": "提交 {value1} 個檔案"
  },
  "仍有未解决的冲突": {
    "en": "Unresolved conflicts remain",
    "zh-TW": "仍有未解決的衝突"
  },
  "合并尚未完成": {
    "en": "Merge not completed",
    "zh-TW": "合併尚未完成"
  },
  "请检查文件和当前合并状态后重试。": {
    "en": "Check the files and merge status, then retry.",
    "zh-TW": "請檢查檔案和目前合併狀態後重試。"
  },
  "合并已完成": {
    "en": "Merge completed",
    "zh-TW": "合併已完成"
  },
  "提交成功": {
    "en": "Commit created",
    "zh-TW": "提交成功"
  },
  "演示提交成功": {
    "en": "Demo commit created",
    "zh-TW": "示範提交成功"
  },
  "{value1} · 已提交暂存内容，未暂存的更改仍然保留。": {
    "en": "{value1} · Staged changes committed; unstaged changes are preserved.",
    "zh-TW": "{value1} · 已提交暫存內容，未暫存的變更仍然保留。"
  },
  "文件变更与提交": {
    "en": "File changes and commit",
    "zh-TW": "檔案變更與提交"
  },
  "文件显示方式": {
    "en": "File display mode",
    "zh-TW": "檔案顯示方式"
  },
  "树形视图": {
    "en": "Tree view",
    "zh-TW": "樹狀檢視"
  },
  "列表视图": {
    "en": "List view",
    "zh-TW": "清單檢視"
  },
  "调整变更列表宽度": {
    "en": "Resize changes panel",
    "zh-TW": "調整變更清單寬度"
  },
  "代码差异": {
    "en": "Code diff",
    "zh-TW": "程式碼差異"
  },
  "正在读取文件差异…": {
    "en": "Loading file diff…",
    "zh-TW": "正在讀取檔案差異…"
  },
  "无法读取差异": {
    "en": "Unable to load diff",
    "zh-TW": "無法讀取差異"
  },
  "文件差异说明": {
    "en": "File diff information",
    "zh-TW": "檔案差異說明"
  },
  "重新读取": {
    "en": "Reload",
    "zh-TW": "重新讀取"
  },
  "工作台设置": {
    "en": "Workbench settings",
    "zh-TW": "工作台設定"
  },
  "调整阅读体验，偏好会保存在当前设备。": {
    "en": "Customize your reading experience. Preferences are saved on this device.",
    "zh-TW": "調整閱讀體驗，偏好會儲存在目前裝置。"
  },
  "代码字号": {
    "en": "Code font size",
    "zh-TW": "程式碼字級"
  },
  "应用于并排和内联代码差异视图。": {
    "en": "Applies to split and inline diff views.",
    "zh-TW": "套用於並排和行內程式碼差異檢視。"
  },
  "恢复默认布局": {
    "en": "Restore default layout",
    "zh-TW": "還原預設版面"
  },
  "重置分栏宽度、字号与 Diff 显示方式。": {
    "en": "Reset panel widths, font size and diff display mode.",
    "zh-TW": "重設分欄寬度、字級與 Diff 顯示方式。"
  },
  "已恢复默认布局": {
    "en": "Default layout restored",
    "zh-TW": "已還原預設版面"
  },
  "恢复": {
    "en": "Restore",
    "zh-TW": "還原"
  },
  "重置示例数据": {
    "en": "Reset demo data",
    "zh-TW": "重設示範資料"
  },
  "恢复最初的文件更改与提交记录。": {
    "en": "Restore the original demo changes and commits.",
    "zh-TW": "還原最初的檔案變更與提交記錄。"
  },
  "示例数据已重置": {
    "en": "Demo data reset",
    "zh-TW": "示範資料已重設"
  },
  "重置": {
    "en": "Reset",
    "zh-TW": "重設"
  },
  "当前版本": {
    "en": "Version",
    "zh-TW": "目前版本"
  },
  "使用系统 Git，提交沿用仓库的作者、签名和 hooks 配置。": {
    "en": "Uses system Git and the repository's author, signing and hooks configuration.",
    "zh-TW": "使用系統 Git，提交沿用儲存庫的作者、簽署和 hooks 設定。"
  },
  "浏览器为界面演示，真实仓库操作请使用桌面应用。": {
    "en": "Browser demo only. Use the desktop app for real repositories.",
    "zh-TW": "瀏覽器僅供介面示範，實際儲存庫操作請使用桌面應用程式。"
  },
  "选择本地 Git 仓库": {
    "en": "Choose a local Git repository",
    "zh-TW": "選擇本機 Git 儲存庫"
  },
  "打开本地仓库": {
    "en": "Open local repository",
    "zh-TW": "開啟本機儲存庫"
  },
  "打开示例仓库": {
    "en": "Open demo repository",
    "zh-TW": "開啟示範儲存庫"
  },
  "选择已存在的 Git 仓库或工作区目录，也可以直接输入本地路径。": {
    "en": "Choose an existing Git repository or worktree, or enter its local path.",
    "zh-TW": "選擇現有的 Git 儲存庫或工作區目錄，也可以直接輸入本機路徑。"
  },
  "浏览器中使用示例数据。请启动桌面应用以管理本地 Git 仓库。": {
    "en": "The browser uses demo data. Open the desktop app to manage local Git repositories.",
    "zh-TW": "瀏覽器中使用示範資料。請啟動桌面應用程式以管理本機 Git 儲存庫。"
  },
  "仓库路径": {
    "en": "Repository path",
    "zh-TW": "儲存庫路徑"
  },
  "/Users/你的用户名/项目目录": {
    "en": "/Users/your-name/project",
    "zh-TW": "/Users/你的使用者名稱/專案目錄"
  },
  "选择文件夹": {
    "en": "Choose folder",
    "zh-TW": "選擇資料夾"
  },
  "正在打开…": {
    "en": "Opening…",
    "zh-TW": "正在開啟…"
  },
  "已打开的仓库": {
    "en": "Open repositories",
    "zh-TW": "已開啟的儲存庫"
  },
  "工作区目录不可用": {
    "en": "Worktree directory unavailable",
    "zh-TW": "工作區目錄無法使用"
  },
  "从一个本地仓库开始": {
    "en": "Start with a local repository",
    "zh-TW": "從一個本機儲存庫開始"
  },
  "查看代码差异，整理暂存区，完成每一次提交。": {
    "en": "Review diffs, organize staged changes and create commits.",
    "zh-TW": "檢視程式碼差異，整理暫存區，完成每一次提交。"
  },
  "支持现有 Git 仓库与 Worktree": {
    "en": "Supports existing Git repositories and worktrees",
    "zh-TW": "支援現有 Git 儲存庫與 Worktree"
  },
  "代码管理": {
    "en": "Git Workbench",
    "zh-TW": "程式碼管理"
  },
  "本地 Git 工作台": {
    "en": "Local Git workbench",
    "zh-TW": "本機 Git 工作台"
  },
  "调整仓库列表宽度": {
    "en": "Resize repository sidebar",
    "zh-TW": "調整儲存庫清單寬度"
  },
  "历史只读": {
    "en": "Read-only history",
    "zh-TW": "歷史唯讀"
  },
  "Git 操作进行中…": {
    "en": "Git operation in progress…",
    "zh-TW": "Git 操作進行中…"
  },
  "正在刷新…": {
    "en": "Refreshing…",
    "zh-TW": "正在重新整理…"
  },
  "{value1} 个文件有更改": {
    "en": "Changed files: {value1}",
    "zh-TW": "{value1} 個檔案有變更"
  },
  "工作区干净": {
    "en": "Working tree clean",
    "zh-TW": "工作區乾淨"
  },
  "本地 Git": {
    "en": "Local Git",
    "zh-TW": "本機 Git"
  },
  "演示模式": {
    "en": "Demo mode",
    "zh-TW": "示範模式"
  },
  "正在恢复上次打开的仓库…": {
    "en": "Restoring previously opened repositories…",
    "zh-TW": "正在還原上次開啟的儲存庫…"
  },
  "分支名称": {
    "en": "Branch name",
    "zh-TW": "分支名稱"
  },
  "起点分支": {
    "en": "Starting branch",
    "zh-TW": "起點分支"
  },
  "暂无可用起点": {
    "en": "No starting point available",
    "zh-TW": "暫無可用起點"
  },
  "当前提交（HEAD）": {
    "en": "Current commit (HEAD)",
    "zh-TW": "目前提交（HEAD）"
  },
  "本地分支": {
    "en": "Local branches",
    "zh-TW": "本機分支"
  },
  "已获取的远程分支": {
    "en": "Fetched remote branches",
    "zh-TW": "已擷取的遠端分支"
  },
  "（当前分支）": {
    "en": " (current branch)",
    "zh-TW": "（目前分支）"
  },
  "可选择本地分支或已获取的远程分支；远程起点会建立上游跟踪关系。": {
    "en": "Choose a local or fetched remote branch. A remote starting point sets up upstream tracking.",
    "zh-TW": "可選擇本機分支或已擷取的遠端分支；遠端起點會建立上游追蹤關係。"
  },
  "创建后切换到新分支": {
    "en": "Switch to the new branch after creation",
    "zh-TW": "建立後切換至新分支"
  },
  "仅创建本地分支，不会推送到远程。": {
    "en": "Creates a local branch without pushing it.",
    "zh-TW": "僅建立本機分支，不會推送至遠端。"
  },
  "取消": {
    "en": "Cancel",
    "zh-TW": "取消"
  },
  "正在创建…": {
    "en": "Creating…",
    "zh-TW": "正在建立…"
  },
  "创建并切换": {
    "en": "Create and switch",
    "zh-TW": "建立並切換"
  },
  "创建分支": {
    "en": "Create branch",
    "zh-TW": "建立分支"
  },
  "{value1} 个提交尚未合入 {value2}": {
    "en": "Commits not merged into {value2}: {value1}",
    "zh-TW": "{value1} 個提交尚未合併至 {value2}"
  },
  "所有提交均已包含在 {value1} 中": {
    "en": "All commits are included in {value1}",
    "zh-TW": "所有提交均已包含在 {value1} 中"
  },
  "删除后将失去此分支引用，未合入提交可能难以找回。": {
    "en": "Deleting removes this branch reference. Unmerged commits may be difficult to recover.",
    "zh-TW": "刪除後將失去此分支參照，未合併的提交可能難以找回。"
  },
  "删除此分支引用，不会删除工作区文件。": {
    "en": "Removes the branch reference without deleting worktree files.",
    "zh-TW": "刪除此分支參照，不會刪除工作區檔案。"
  },
  "只删除本地分支，远程分支不受影响。": {
    "en": "Only the local branch is deleted. Remote branches are unchanged.",
    "zh-TW": "只刪除本機分支，遠端分支不受影響。"
  },
  "我了解风险，仍要强制删除此分支": {
    "en": "I understand the risk and want to force delete this branch",
    "zh-TW": "我了解風險，仍要強制刪除此分支"
  },
  "正在删除…": {
    "en": "Deleting…",
    "zh-TW": "正在刪除…"
  },
  "强制删除": {
    "en": "Force delete",
    "zh-TW": "強制刪除"
  },
  "删除分支": {
    "en": "Delete branch",
    "zh-TW": "刪除分支"
  },
  "当前分支": {
    "en": "Current branch",
    "zh-TW": "目前分支"
  },
  "其他工作区使用中": {
    "en": "Used by another worktree",
    "zh-TW": "其他工作區使用中"
  },
  "远程未配置": {
    "en": "Remote not configured",
    "zh-TW": "遠端未設定"
  },
  "无法确定": {
    "en": "Unknown",
    "zh-TW": "無法確定"
  },
  "本地跟踪分支：{value1}": {
    "en": "Local tracking branch: {value1}",
    "zh-TW": "本機追蹤分支：{value1}"
  },
  "跟踪 {value1}": {
    "en": "Tracks {value1}",
    "zh-TW": "追蹤 {value1}"
  },
  "（无提交说明）": {
    "en": "(No commit message)",
    "zh-TW": "（無提交說明）"
  },
  "当前分支不能删除": {
    "en": "Cannot delete the current branch",
    "zh-TW": "目前分支不能刪除"
  },
  "分支正在工作区使用，不能删除": {
    "en": "Cannot delete a branch in use by a worktree",
    "zh-TW": "分支正在工作區使用，不能刪除"
  },
  "切换到 {value1}": {
    "en": "Switch to {value1}",
    "zh-TW": "切換至 {value1}"
  },
  "切换分支": {
    "en": "Switch branch",
    "zh-TW": "切換分支"
  },
  "删除本地分支 {value1}": {
    "en": "Delete local branch {value1}",
    "zh-TW": "刪除本機分支 {value1}"
  },
  "删除本地分支": {
    "en": "Delete local branch",
    "zh-TW": "刪除本機分支"
  },
  "请先完成或中止当前 Git 操作，再创建、删除或切换分支。": {
    "en": "Complete or abort the current Git operation before creating, deleting or switching branches.",
    "zh-TW": "請先完成或中止目前 Git 操作，再建立、刪除或切換分支。"
  },
  "已切换到 {value1}": {
    "en": "Switched to {value1}",
    "zh-TW": "已切換至 {value1}"
  },
  "演示操作，未修改本地仓库": {
    "en": "Demo operation; local repositories are unchanged",
    "zh-TW": "示範操作，未修改本機儲存庫"
  },
  "已创建并切换到 {value1}": {
    "en": "Created and switched to {value1}",
    "zh-TW": "已建立並切換至 {value1}"
  },
  "已创建分支 {value1}": {
    "en": "Created branch {value1}",
    "zh-TW": "已建立分支 {value1}"
  },
  "已删除 {value1}": {
    "en": "Deleted {value1}",
    "zh-TW": "已刪除 {value1}"
  },
  "新建分支": {
    "en": "New branch",
    "zh-TW": "新增分支"
  },
  "分支管理": {
    "en": "Branch management",
    "zh-TW": "分支管理"
  },
  "在 {value1} 中创建本地分支": {
    "en": "Create a local branch in {value1}",
    "zh-TW": "在 {value1} 中建立本機分支"
  },
  "{value1} · 当前 {value2}": {
    "en": "{value1} · Current: {value2}",
    "zh-TW": "{value1} · 目前 {value2}"
  },
  "演示模式 · 模拟数据": {
    "en": "Demo mode · Sample data",
    "zh-TW": "示範模式 · 模擬資料"
  },
  "搜索分支": {
    "en": "Search branches",
    "zh-TW": "搜尋分支"
  },
  "搜索本地或远程分支…": {
    "en": "Search local or remote branches…",
    "zh-TW": "搜尋本機或遠端分支…"
  },
  "没有可用起点，请先完成首次提交。": {
    "en": "No starting point is available. Create an initial commit first.",
    "zh-TW": "沒有可用起點，請先完成首次提交。"
  },
  "分支列表": {
    "en": "Branch list",
    "zh-TW": "分支清單"
  },
  "正在读取分支…": {
    "en": "Loading branches…",
    "zh-TW": "正在讀取分支…"
  },
  "重新读取分支": {
    "en": "Reload branches",
    "zh-TW": "重新讀取分支"
  },
  "没有匹配“{value1}”的分支": {
    "en": "No branches match “{value1}”",
    "zh-TW": "沒有符合「{value1}」的分支"
  },
  "暂无分支记录，完成首次提交后可在此查看。": {
    "en": "No branches yet. Create an initial commit to see them here.",
    "zh-TW": "暫無分支記錄，完成首次提交後可在此檢視。"
  },
  "远程分支": {
    "en": "Remote branches",
    "zh-TW": "遠端分支"
  },
  "最近提交优先": {
    "en": "Latest commits first",
    "zh-TW": "最近提交優先"
  },
  "远程分支来自本地已获取的记录；切换后会检查远程上游并自动快进拉取。": {
    "en": "Remote branches use fetched references. Switching checks the remote upstream and pulls fast-forward updates automatically.",
    "zh-TW": "遠端分支來自本機已擷取的記錄；切換後會檢查遠端上游並自動快進拉取。"
  },
  "正在切换并检查远程更新，落后时自动快进拉取…": {
    "en": "Switching and checking remote updates; pulling fast-forward updates when behind…",
    "zh-TW": "正在切換並檢查遠端更新，落後時自動快進拉取…"
  },
  "正在检查分支…": {
    "en": "Checking branch…",
    "zh-TW": "正在檢查分支…"
  },
  "重新检查分支": {
    "en": "Recheck branch",
    "zh-TW": "重新檢查分支"
  },
  "{value1} · {value2} 个变更文件": {
    "en": "{value1} · Changed files: {value2}",
    "zh-TW": "{value1} · {value2} 個變更檔案"
  },
  "文件夹 {value1}": {
    "en": "Folder {value1}",
    "zh-TW": "資料夾 {value1}"
  },
  "选择一个文件，查看更改": {
    "en": "Select a file to review changes",
    "zh-TW": "選擇一個檔案，檢視變更"
  },
  "在左侧选择未暂存或已暂存的文件": {
    "en": "Select an unstaged or staged file on the left",
    "zh-TW": "在左側選擇未暫存或已暫存的檔案"
  },
  "每一次清晰的提交，都从查看差异开始": {
    "en": "Every clear commit starts with reviewing its diff",
    "zh-TW": "每一次清楚的提交，都從檢視差異開始"
  },
  "HEAD（上次提交）": {
    "en": "HEAD (last commit)",
    "zh-TW": "HEAD（上次提交）"
  },
  "暂存区（当前版本）": {
    "en": "Index (current version)",
    "zh-TW": "暫存區（目前版本）"
  },
  "暂存区（已暂存的更改）": {
    "en": "Index (staged changes)",
    "zh-TW": "暫存區（已暫存的變更）"
  },
  "工作区（未暂存的更改）": {
    "en": "Working tree (unstaged changes)",
    "zh-TW": "工作區（未暫存的變更）"
  },
  "{value1} 的代码差异": {
    "en": "Diff for {value1}",
    "zh-TW": "{value1} 的程式碼差異"
  },
  "关闭文件": {
    "en": "Close file",
    "zh-TW": "關閉檔案"
  },
  "只读": {
    "en": "Read-only",
    "zh-TW": "唯讀"
  },
  "差异显示方式": {
    "en": "Diff display mode",
    "zh-TW": "差異顯示方式"
  },
  "并排": {
    "en": "Split",
    "zh-TW": "並排"
  },
  "内联": {
    "en": "Inline",
    "zh-TW": "行內"
  },
  "新增 {value1} 行，删除 {value2} 行": {
    "en": "Added lines: {value1}, deleted lines: {value2}",
    "zh-TW": "新增 {value1} 行，刪除 {value2} 行"
  },
  "变更较复杂，已省略行数统计与分块导航": {
    "en": "Line counts and hunk navigation are unavailable for this complex diff",
    "zh-TW": "變更較複雜，已省略行數統計與區塊導覽"
  },
  "统计已省略": {
    "en": "Stats unavailable",
    "zh-TW": "統計已省略"
  },
  "暂存第 {value1} 个变更块": {
    "en": "Stage hunk {value1}",
    "zh-TW": "暫存第 {value1} 個變更區塊"
  },
  "暂存此块": {
    "en": "Stage hunk",
    "zh-TW": "暫存此區塊"
  },
  "当前变更块": {
    "en": "Current hunk",
    "zh-TW": "目前變更區塊"
  },
  "分块导航不可用": {
    "en": "Hunk navigation unavailable",
    "zh-TW": "區塊導覽無法使用"
  },
  "上一个变更块": {
    "en": "Previous hunk",
    "zh-TW": "上一個變更區塊"
  },
  "下一个变更块": {
    "en": "Next hunk",
    "zh-TW": "下一個變更區塊"
  },
  "复制完整 Hash {value1}": {
    "en": "Copy full hash {value1}",
    "zh-TW": "複製完整 Hash {value1}"
  },
  "复制完整 Hash": {
    "en": "Copy full hash",
    "zh-TW": "複製完整 Hash"
  },
  "已复制完整 Hash": {
    "en": "Full hash copied",
    "zh-TW": "已複製完整 Hash"
  },
  "复制失败，请在提交详情中选择 Hash 复制。": {
    "en": "Copy failed. Select and copy the hash in the commit details.",
    "zh-TW": "複製失敗，請在提交詳情中選取 Hash 複製。"
  },
  "远程 · ": {
    "en": "Remote · ",
    "zh-TW": "遠端 · "
  },
  "历史分支筛选": {
    "en": "History branch filter",
    "zh-TW": "歷史分支篩選"
  },
  "只筛选提交历史，不切换工作区分支": {
    "en": "Filters history without switching the worktree branch",
    "zh-TW": "僅篩選提交歷史，不切換工作區分支"
  },
  "当前 HEAD": {
    "en": "Current HEAD",
    "zh-TW": "目前 HEAD"
  },
  "重新读取历史分支": {
    "en": "Reload history branches",
    "zh-TW": "重新讀取歷史分支"
  },
  "历史文件：{value1}": {
    "en": "History file: {value1}",
    "zh-TW": "歷史檔案：{value1}"
  },
  "历史已更新，刷新查看": {
    "en": "History has changed. Refresh to view updates",
    "zh-TW": "歷史已更新，請重新整理以檢視"
  },
  "刷新历史": {
    "en": "Refresh history",
    "zh-TW": "重新整理歷史"
  },
  "重试检查": {
    "en": "Retry check",
    "zh-TW": "重試檢查"
  },
  "提交列表": {
    "en": "Commit list",
    "zh-TW": "提交清單"
  },
  "搜索提交历史": {
    "en": "Search history",
    "zh-TW": "搜尋提交歷史"
  },
  "搜索说明、作者或 Hash": {
    "en": "Search message, author or hash",
    "zh-TW": "搜尋說明、作者或 Hash"
  },
  "清除历史搜索": {
    "en": "Clear history search",
    "zh-TW": "清除歷史搜尋"
  },
  "重试历史": {
    "en": "Retry history",
    "zh-TW": "重試歷史"
  },
  "提交记录": {
    "en": "Commits",
    "zh-TW": "提交記錄"
  },
  "正在读取提交…": {
    "en": "Loading commits…",
    "zh-TW": "正在讀取提交…"
  },
  "查看提交：{value1}": {
    "en": "View commit: {value1}",
    "zh-TW": "檢視提交：{value1}"
  },
  "没有匹配的提交": {
    "en": "No matching commits",
    "zh-TW": "沒有符合的提交"
  },
  "此分支还没有提交记录": {
    "en": "This branch has no commits yet",
    "zh-TW": "此分支尚無提交記錄"
  },
  "尝试其他说明、作者或完整 Hash。": {
    "en": "Try another message, author or full hash.",
    "zh-TW": "請嘗試其他說明、作者或完整 Hash。"
  },
  "正在加载…": {
    "en": "Loading…",
    "zh-TW": "正在載入…"
  },
  "加载更多提交": {
    "en": "Load more commits",
    "zh-TW": "載入更多提交"
  },
  " · 可加载更多": {
    "en": " · More available",
    "zh-TW": " · 可載入更多"
  },
  "调整提交列表宽度": {
    "en": "Resize commit list",
    "zh-TW": "調整提交清單寬度"
  },
  "历史变更文件": {
    "en": "History changed files",
    "zh-TW": "歷史變更檔案"
  },
  "变更文件": {
    "en": "Changed files",
    "zh-TW": "變更檔案"
  },
  "正在读取变更…": {
    "en": "Loading changes…",
    "zh-TW": "正在讀取變更…"
  },
  "重试提交": {
    "en": "Retry commit",
    "zh-TW": "重試提交"
  },
  "此提交相对此父提交没有文件变更": {
    "en": "No file changes compared with this parent",
    "zh-TW": "此提交相對此父提交沒有檔案變更"
  },
  "选择提交，查看变更文件": {
    "en": "Select a commit to view changed files",
    "zh-TW": "選擇提交，檢視變更檔案"
  },
  "调整历史文件列表宽度": {
    "en": "Resize history file list",
    "zh-TW": "調整歷史檔案清單寬度"
  },
  "历史差异": {
    "en": "History diff",
    "zh-TW": "歷史差異"
  },
  "比较对象": {
    "en": "Compare with",
    "zh-TW": "比較對象"
  },
  "比较父提交": {
    "en": "Compare parent commit",
    "zh-TW": "比較父提交"
  },
  "父提交": {
    "en": "Parent",
    "zh-TW": "父提交"
  },
  "文件模式": {
    "en": "File mode",
    "zh-TW": "檔案模式"
  },
  "正在读取历史差异…": {
    "en": "Loading history diff…",
    "zh-TW": "正在讀取歷史差異…"
  },
  "重试差异": {
    "en": "Retry diff",
    "zh-TW": "重試差異"
  },
  "无法读取历史差异": {
    "en": "Unable to load history diff",
    "zh-TW": "無法讀取歷史差異"
  },
  "父提交 {value1} · {value2}": {
    "en": "Parent {value1} · {value2}",
    "zh-TW": "父提交 {value1} · {value2}"
  },
  "空版本（首次提交）": {
    "en": "Empty version (initial commit)",
    "zh-TW": "空版本（首次提交）"
  },
  "当前提交 · {value1}": {
    "en": "Current commit · {value1}",
    "zh-TW": "目前提交 · {value1}"
  },
  "此提交没有文件变更": {
    "en": "This commit has no file changes",
    "zh-TW": "此提交沒有檔案變更"
  },
  "选择文件，查看历史差异": {
    "en": "Select a file to view its history diff",
    "zh-TW": "選擇檔案，檢視歷史差異"
  },
  "历史文件来自 Git 提交快照，只读展示。": {
    "en": "Historical files are read-only Git commit snapshots.",
    "zh-TW": "歷史檔案來自 Git 提交快照，僅供唯讀檢視。"
  },
  "选择 {value1} 作为合并来源": {
    "en": "Select {value1} as the merge source",
    "zh-TW": "選擇 {value1} 作為合併來源"
  },
  "其他工作区": {
    "en": "Other worktree",
    "zh-TW": "其他工作區"
  },
  "当前工作区或分支已变化，请关闭弹窗后重新选择。": {
    "en": "The worktree or branch has changed. Close this dialog and select again.",
    "zh-TW": "目前工作區或分支已變更，請關閉對話框後重新選擇。"
  },
  "当前分支已变化，请刷新后重新打开合并。": {
    "en": "The current branch has changed. Refresh and reopen the merge dialog.",
    "zh-TW": "目前分支已變更，請重新整理後再次開啟合併。"
  },
  "合并存在冲突": {
    "en": "Merge conflicts found",
    "zh-TW": "合併發生衝突"
  },
  "请在主界面解决冲突并暂存，然后完成合并；也可以中止合并。": {
    "en": "Resolve and stage conflicts in the main view, then complete or abort the merge.",
    "zh-TW": "請在主介面解決衝突並暫存，然後完成合併；也可以中止合併。"
  },
  "请在主界面检查并完成合并，或中止本次合并。": {
    "en": "Review and complete the merge in the main view, or abort it.",
    "zh-TW": "請在主介面檢查並完成合併，或中止本次合併。"
  },
  "当前分支已包含来源提交，无需合并。": {
    "en": "The current branch already contains these commits. No merge needed.",
    "zh-TW": "目前分支已包含來源提交，無需合併。"
  },
  "已合并到 {value1}": {
    "en": "Merged into {value1}",
    "zh-TW": "已合併至 {value1}"
  },
  "已快进合并到 {value1}": {
    "en": "Fast-forwarded to {value1}",
    "zh-TW": "已快進合併至 {value1}"
  },
  "选择来源分支，将它的已提交内容合入当前分支。": {
    "en": "Choose a source branch to merge its commits into the current branch.",
    "zh-TW": "選擇來源分支，將它的已提交內容合併至目前分支。"
  },
  "搜索合并来源分支": {
    "en": "Search merge source branches",
    "zh-TW": "搜尋合併來源分支"
  },
  "合并来源分支列表": {
    "en": "Merge source branches",
    "zh-TW": "合併來源分支清單"
  },
  "暂无其他可合并的分支。": {
    "en": "No other branches available to merge.",
    "zh-TW": "暫無其他可合併的分支。"
  },
  "正在检查合并…": {
    "en": "Checking merge…",
    "zh-TW": "正在檢查合併…"
  },
  "可快进合并": {
    "en": "Fast-forward available",
    "zh-TW": "可快進合併"
  },
  "将创建合并提交": {
    "en": "Creates a merge commit",
    "zh-TW": "將建立合併提交"
  },
  "执行时仍可能出现冲突": {
    "en": "Conflicts may still occur",
    "zh-TW": "執行時仍可能發生衝突"
  },
  "{count} 个待合入提交": {
    "en": "Incoming commits: {count}",
    "zh-TW": "{count} 個待合併提交"
  },
  "重新检查合并": {
    "en": "Recheck merge",
    "zh-TW": "重新檢查合併"
  },
  "请先选择要合入的来源分支。": {
    "en": "Select a source branch first.",
    "zh-TW": "請先選擇要合併的來源分支。"
  },
  "始终创建合并提交": {
    "en": "Always create a merge commit",
    "zh-TW": "一律建立合併提交"
  },
  "远程分支来自本地已获取的记录；合并不包含其他工作区尚未提交的更改。": {
    "en": "Remote branches use fetched references. Uncommitted changes in other worktrees are excluded.",
    "zh-TW": "遠端分支來自本機已擷取的記錄；合併不包含其他工作區尚未提交的變更。"
  },
  "正在合并…": {
    "en": "Merging…",
    "zh-TW": "正在合併…"
  },
  "合并已中止": {
    "en": "Merge aborted",
    "zh-TW": "合併已中止"
  },
  "当前分支仍为 {value1}": {
    "en": "Current branch remains {value1}",
    "zh-TW": "目前分支仍為 {value1}"
  },
  "正在合并 {value1} → {value2}": {
    "en": "Merging {value1} → {value2}",
    "zh-TW": "正在合併 {value1} → {value2}"
  },
  "正在{value1}": {
    "en": "In progress: {value1}",
    "zh-TW": "正在{value1}"
  },
  "请在外部工具中完成或中止该操作，应用会自动更新状态。": {
    "en": "Complete or abort this operation in an external tool. The app will update automatically.",
    "zh-TW": "請在外部工具中完成或中止該操作，應用程式會自動更新狀態。"
  },
  "{value1} 个文件存在冲突。请在编辑器中解决后暂存，再完成合并。": {
    "en": "Files with conflicts: {value1}. Resolve them in an editor, stage them and complete the merge.",
    "zh-TW": "{value1} 個檔案存在衝突。請在編輯器中解決後暫存，再完成合併。"
  },
  "检查暂存内容和合并提交信息，点击“完成合并”结束本次操作。": {
    "en": "Review staged changes and the merge message, then select “Complete merge”.",
    "zh-TW": "檢查暫存內容和合併提交訊息，點選「完成合併」結束本次操作。"
  },
  "中止合并": {
    "en": "Abort merge",
    "zh-TW": "中止合併"
  },
  "中止当前合并？": {
    "en": "Abort the current merge?",
    "zh-TW": "中止目前合併？"
  },
  "继续处理": {
    "en": "Continue working",
    "zh-TW": "繼續處理"
  },
  "正在中止…": {
    "en": "Aborting…",
    "zh-TW": "正在中止…"
  },
  "确认中止合并": {
    "en": "Confirm abort",
    "zh-TW": "確認中止合併"
  },
  "获取": {
    "en": "Fetch",
    "zh-TW": "擷取"
  },
  "拉取": {
    "en": "Pull",
    "zh-TW": "拉取"
  },
  "推送": {
    "en": "Push",
    "zh-TW": "推送"
  },
  "发布分支": {
    "en": "Publish branch",
    "zh-TW": "發佈分支"
  },
  "发布中…": {
    "en": "Publishing…",
    "zh-TW": "發佈中…"
  },
  "发布中，请稍候…": {
    "en": "Publishing, please wait…",
    "zh-TW": "發佈中，請稍候…"
  },
  "发布到 {destination}，并建立上游跟踪。": {
    "en": "Publish to {destination} and set up upstream tracking.",
    "zh-TW": "發佈至 {destination}，並建立上游追蹤。"
  },
  "选择远程仓库发布当前分支，并建立上游跟踪。": {
    "en": "Choose a remote to publish the current branch and set up upstream tracking.",
    "zh-TW": "選擇遠端儲存庫發佈目前分支，並建立上游追蹤。"
  },
  "分支发布成功": {
    "en": "Branch published",
    "zh-TW": "分支發佈成功"
  },
  "分支发布失败": {
    "en": "Branch publishing failed",
    "zh-TW": "分支發佈失敗"
  },
  "分支已推送，请查看仓库状态中的警告": {
    "en": "Branch pushed. Check the repository status for warnings",
    "zh-TW": "分支已推送，請查看儲存庫狀態中的警告"
  },
  "获取所有远程仓库的最新引用": {
    "en": "Fetch the latest references from all remotes",
    "zh-TW": "擷取所有遠端儲存庫的最新參照"
  },
  "从 {value1} 拉取，只允许快进；分叉时请先合并": {
    "en": "Pull from {value1} using fast-forward only; merge diverged branches first",
    "zh-TW": "從 {value1} 拉取，僅允許快進；分歧時請先合併"
  },
  "待拉取数量未知": {
    "en": "Incoming commit count unknown",
    "zh-TW": "待拉取數量未知"
  },
  "{value1} 个待拉取提交": {
    "en": "Commits to pull: {value1}",
    "zh-TW": "{value1} 個待拉取提交"
  },
  "没有待拉取提交": {
    "en": "No commits to pull",
    "zh-TW": "沒有待拉取提交"
  },
  "{value1}，{value2} 个待拉取提交": {
    "en": "{value1}, commits to pull: {value2}",
    "zh-TW": "{value1}，{value2} 個待拉取提交"
  },
  "待上传数量未知": {
    "en": "Pending commit count unknown",
    "zh-TW": "待上傳數量未知"
  },
  "{value1} 个待上传提交": {
    "en": "Commits to push: {value1}",
    "zh-TW": "{value1} 個待上傳提交"
  },
  "没有待上传提交": {
    "en": "No commits to push",
    "zh-TW": "沒有待上傳提交"
  },
  "推送到 {value1}": {
    "en": "Push to {value1}",
    "zh-TW": "推送至 {value1}"
  },
  "选择远程仓库并推送当前分支": {
    "en": "Choose a remote and push the current branch",
    "zh-TW": "選擇遠端儲存庫並推送目前分支"
  },
  "数量基于最近获取的远程引用": {
    "en": "Count based on the most recently fetched references",
    "zh-TW": "數量依據最近擷取的遠端參照"
  },
  "{value1}已完成，请查看仓库状态中的警告": {
    "en": "{value1} completed. Check the repository status for warnings",
    "zh-TW": "{value1}已完成，請查看儲存庫狀態中的警告"
  },
  "{value1}完成": {
    "en": "{value1} completed",
    "zh-TW": "{value1}完成"
  },
  "{value1}失败": {
    "en": "{value1} failed",
    "zh-TW": "{value1}失敗"
  },
  "{value1}中": {
    "en": "{value1} in progress",
    "zh-TW": "{value1}中"
  },
  "{value1}，{value2} 个待上传提交": {
    "en": "{value1}, commits to push: {value2}",
    "zh-TW": "{value1}，{value2} 個待上傳提交"
  },
  "{value1}中，请稍候…": {
    "en": "{value1} in progress, please wait…",
    "zh-TW": "{value1}中，請稍候…"
  },
  "远程仓库": {
    "en": "Remote",
    "zh-TW": "遠端儲存庫"
  },
  "刚刚": {
    "en": "Just now",
    "zh-TW": "剛剛"
  },
  "关闭": {
    "en": "Close",
    "zh-TW": "關閉"
  },
  "界面语言": {
    "en": "Interface language",
    "zh-TW": "介面語言"
  },
  "切换后立即生效，并保存在当前设备。": {
    "en": "Changes apply immediately and are saved on this device.",
    "zh-TW": "切換後立即生效，並儲存在目前裝置。"
  },
  "暂存目录 {path}": {
    "en": "Stage directory {path}",
    "zh-TW": "暫存目錄 {path}"
  },
  "取消暂存目录 {path}": {
    "en": "Unstage directory {path}",
    "zh-TW": "取消暫存目錄 {path}"
  },
  "暂存全部变更": {
    "en": "Stage all changes",
    "zh-TW": "暫存全部變更"
  },
  "取消暂存全部变更": {
    "en": "Unstage all changes",
    "zh-TW": "取消暫存全部變更"
  },
  "选择接收 {branch} 的远程仓库。": {
    "en": "Choose the remote repository to receive {branch}.",
    "zh-TW": "選擇接收 {branch} 的遠端儲存庫。"
  },
  "将中止 {source} → {target}，撤销此次合并及冲突解决过程中的修改。需要保留的内容请先另行保存。": {
    "en": "Abort {source} → {target} and discard changes made during this merge and conflict resolution. Save anything you need elsewhere first.",
    "zh-TW": "將中止 {source} → {target}，復原此次合併及衝突解決過程中的修改。需要保留的內容請先另行儲存。"
  },
  "合并到 {branch}": {
    "en": "Merge into {branch}",
    "zh-TW": "合併至 {branch}"
  },
  "{count} 条": {
    "en": "Commits: {count}",
    "zh-TW": "{count} 筆"
  },
  "通知": {
    "en": "Notifications",
    "zh-TW": "通知"
  },
  "关闭通知": {
    "en": "Close notification",
    "zh-TW": "關閉通知"
  }
};
