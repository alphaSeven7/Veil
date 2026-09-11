import Foundation

/// 本地 API 文档（同时供 UI 展示）
public enum APIDocs {
    public static let endpoints: [[String: Any]] = [
        ["method": "GET", "path": "/health", "desc": "健康检查", "body": "",
         "example": "curl http://127.0.0.1:54345/health"],
        ["method": "POST", "path": "/browser/open", "desc": "打开窗口（返回 CDP 连接信息，可直接给 Selenium / Playwright / Puppeteer 使用）",
         "body": "{\"id\":\"窗口ID\"} 或 {\"seq\":1} 或 {\"ids\":[\"id1\",\"id2\"]}",
         "example": "curl -X POST http://127.0.0.1:54345/browser/open -H 'Content-Type: application/json' -d '{\"seq\":1}'"],
        ["method": "POST", "path": "/browser/close", "desc": "关闭窗口", "body": "{\"id\":\"窗口ID\"}", "example": ""],
        ["method": "POST", "path": "/browser/list", "desc": "窗口分页列表", "body": "{\"page\":0,\"pageSize\":50,\"name\":\"\",\"groupId\":\"\"}", "example": ""],
        ["method": "POST", "path": "/browser/detail", "desc": "窗口详情（含完整指纹）", "body": "{\"id\":\"窗口ID\"}", "example": ""],
        ["method": "POST", "path": "/browser/add", "desc": "新建窗口", "body": "{\"name\":\"\",\"platform\":\"windows\",\"country\":\"US\",\"groupId\":\"\"}", "example": ""],
        ["method": "POST", "path": "/browser/update", "desc": "更新窗口", "body": "{\"id\":\"\",\"name\":\"\",\"fingerprint\":{...},\"proxy\":{...}}", "example": ""],
        ["method": "POST", "path": "/browser/delete", "desc": "删除窗口", "body": "{\"ids\":[\"id1\"],\"deleteCache\":true}", "example": ""],
        ["method": "POST", "path": "/browser/enable", "desc": "启用窗口", "body": "{\"ids\":[\"id1\"]}", "example": ""],
        ["method": "POST", "path": "/browser/disable", "desc": "停用窗口", "body": "{\"ids\":[\"id1\"]}", "example": ""],
        ["method": "POST", "path": "/browser/local-active", "desc": "当前运行中的窗口", "body": "{}", "example": ""],
        ["method": "POST", "path": "/browser/pids", "desc": "窗口 ID -> 进程 PID 映射", "body": "{}", "example": ""],
        ["method": "POST", "path": "/browser/navigate", "desc": "[Veil 扩展] 让运行中的窗口跳转到指定 URL", "body": "{\"id\":\"\",\"url\":\"https://example.com\"}", "example": ""],
        ["method": "POST", "path": "/browser/tabs", "desc": "[Veil 扩展] 列出运行中窗口的标签页", "body": "{\"id\":\"\"}", "example": ""],
        ["method": "POST", "path": "/browser/evaluate", "desc": "[Veil 扩展] 在运行中窗口执行 JS 并返回结果", "body": "{\"id\":\"\",\"expression\":\"navigator.userAgent\"}", "example": ""],
        ["method": "POST", "path": "/group/list", "desc": "分组列表", "body": "{}", "example": ""],
        ["method": "POST", "path": "/group/add", "desc": "新建分组", "body": "{\"groupName\":\"\",\"color\":\"#7c8cff\"}", "example": ""],
        ["method": "POST", "path": "/group/update", "desc": "更新分组", "body": "{\"groupId\":\"\",\"groupName\":\"\"}", "example": ""],
        ["method": "POST", "path": "/group/delete", "desc": "删除分组", "body": "{\"groupId\":\"\"}", "example": ""],
        ["method": "POST", "path": "/proxy/check", "desc": "检测代理出口 IP / 国家 / 时区 / 延迟",
         "body": "{\"proxy\":{\"type\":\"http\",\"host\":\"\",\"port\":0,\"username\":\"\",\"password\":\"\"}}", "example": ""],
        ["method": "POST", "path": "/cookie/list", "desc": "读取窗口 Cookie（运行中则读取实时值）", "body": "{\"id\":\"\"}", "example": ""],
        ["method": "POST", "path": "/cookie/import", "desc": "导入 Cookie（JSON / Netscape / document.cookie）", "body": "{\"id\":\"\",\"cookies\":[...]}", "example": ""],
        ["method": "POST", "path": "/cookie/clear", "desc": "清空窗口 Cookie", "body": "{\"id\":\"\"}", "example": ""],
        ["method": "POST", "path": "/fingerprint/random", "desc": "生成一个随机指纹", "body": "{\"platform\":\"windows\",\"country\":\"US\"}", "example": ""],
        ["method": "POST", "path": "/host/probe", "desc": "重新探测本机真实指纹", "body": "{}", "example": ""],
        ["method": "POST", "path": "/host/info", "desc": "读取本机探针缓存", "body": "{}", "example": ""],
        ["method": "POST", "path": "/template/list", "desc": "指纹模板列表", "body": "{}", "example": ""],
        ["method": "GET", "path": "/__veil/detect.html", "desc": "指纹自检页（可在窗口内打开）", "body": "?profile=窗口ID", "example": ""],
    ]

    public static let integrationSnippets: [[String: String]] = [
        ["lang": "python", "name": "Python + Playwright", "code": """
        import requests
        from playwright.sync_api import sync_playwright

        r = requests.post("http://127.0.0.1:54345/browser/open", json={"seq": 1}).json()
        http = r["data"]["http"]          # 例如 http://127.0.0.1:52341

        with sync_playwright() as p:
            browser = p.chromium.connect_over_cdp(http)
            ctx = browser.contexts[0]
            page = ctx.pages[0] if ctx.pages else ctx.new_page()
            page.goto("https://browserleaks.com/javascript")
            print(page.evaluate("navigator.userAgent"))
            browser.close()               # 只断开连接，窗口保持运行
        requests.post("http://127.0.0.1:54345/browser/close", json={"seq": 1})
        """],
        ["lang": "python", "name": "Python + Selenium", "code": """
        import requests
        from selenium import webdriver
        from selenium.webdriver.chrome.options import Options

        r = requests.post("http://127.0.0.1:54345/browser/open", json={"seq": 1}).json()
        d = r["data"]

        opts = Options()
        opts.add_experimental_option("debuggerAddress", f"127.0.0.1:{d['debugPort']}")
        driver = webdriver.Chrome(options=opts)     # 复用 Veil 已启动的窗口
        driver.get("https://whoer.net")
        print(driver.execute_script("return navigator.userAgent"))
        driver.quit()
        """],
        ["lang": "javascript", "name": "Node.js + Puppeteer", "code": """
        const puppeteer = require('puppeteer-core');

        const { data } = await (await fetch('http://127.0.0.1:54345/browser/open', {
          method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({seq: 1})
        })).json();

        const browser = await puppeteer.connect({ browserWSEndpoint: data.wsUrl });
        const page = (await browser.pages())[0] || await browser.newPage();
        await page.goto('https://browserleaks.com/canvas');
        console.log(await page.evaluate(() => navigator.userAgent));
        await browser.disconnect();
        """],
        ["lang": "bash", "name": "curl 快速验证", "code": """
        # 健康检查
        curl -s http://127.0.0.1:54345/health | jq

        # 新建一个 Windows 环境窗口
        curl -s -X POST http://127.0.0.1:54345/browser/add \\
          -H 'Content-Type: application/json' \\
          -d '{"name":"API 创建","platform":"windows","country":"US"}' | jq

        # 打开第 1 个窗口并拿到 CDP 地址
        curl -s -X POST http://127.0.0.1:54345/browser/open -d '{"seq":1}' | jq '.data.http'

        # 查看当前运行中的窗口
        curl -s -X POST http://127.0.0.1:54345/browser/local-active -d '{}' | jq
        """],
    ]
}
