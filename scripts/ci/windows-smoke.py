"""在 Windows 运行机中用真实 WebView 和临时 Git 仓库验收安装后的应用。"""
import base64
import json
import os
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path


class WebDriverError(Exception):
    pass


class Driver:
    """使用 WebDriver 标准接口操作已安装的 Tauri 窗口。"""

    def __init__(self):
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        self.session = ''

    def request(self, method, path, data=None, timeout=30):
        payload = json.dumps(data, ensure_ascii=False).encode('utf-8') if data is not None else None
        request = urllib.request.Request(
            'http://127.0.0.1:4444' + path,
            data=payload,
            headers={'Content-Type': 'application/json; charset=utf-8'},
            method=method,
        )
        try:
            with self.opener.open(request, timeout=timeout) as response:
                result = json.loads(response.read().decode('utf-8'))
        except urllib.error.HTTPError as error:
            detail = error.read().decode('utf-8', errors='replace')
            raise WebDriverError(detail) from error
        return result.get('value')

    def start(self, application):
        result = self.request('POST', '/session', {
            'capabilities': {'alwaysMatch': {
                'browserName': 'wry',
                'tauri:options': {'application': str(application), 'webviewOptions': {}},
            }},
        }, timeout=90)
        self.session = result['sessionId']

    def path(self, suffix):
        return f'/session/{self.session}{suffix}'

    def element(self, selector, using='css selector', timeout=35):
        deadline = time.monotonic() + timeout
        last_error = None
        while time.monotonic() < deadline:
            try:
                result = self.request('POST', self.path('/element'), {'using': using, 'value': selector})
                return result['element-6066-11e4-a52e-4f735466cecf']
            except WebDriverError as error:
                last_error = error
                if 'no such element' not in str(error).lower():
                    raise
                time.sleep(0.3)
        raise RuntimeError(f'未找到界面元素 {selector}: {last_error}')

    def click(self, selector, using='css selector'):
        element = self.element(selector, using)
        self.request('POST', self.path(f'/element/{element}/click'), {})

    def type(self, selector, text):
        element = self.element(selector)
        self.request('POST', self.path(f'/element/{element}/value'), {'text': text, 'value': list(text)})

    def script(self, script):
        return self.request('POST', self.path('/execute/sync'), {'script': script, 'args': []})

    def screenshot(self, path):
        content = self.request('GET', self.path('/screenshot'))
        path.write_bytes(base64.b64decode(content))

    def close(self):
        if self.session:
            self.request('DELETE', self.path(''))


def git(repo, *args):
    return subprocess.run(['git', '-C', str(repo), *args], check=True, capture_output=True).stdout.decode('utf-8')


def prepare_repository():
    repo = Path(os.environ['RUNNER_TEMP']) / 'gw-windows-ui-fixture'
    (repo / 'src').mkdir(parents=True)
    git(repo, 'init', '-b', 'main')
    for key, value in [('user.name', 'Windows QA'), ('user.email', 'qa@example.invalid'),
                       ('commit.gpgSign', 'false'), ('core.autocrlf', 'false'),
                       ('core.hooksPath', str(repo / 'no-hooks'))]:
        git(repo, 'config', key, value)
    file = repo / 'src' / 'sample.txt'
    file.write_bytes(b'base version\n')
    git(repo, 'add', '--', 'src/sample.txt')
    git(repo, 'commit', '-m', 'chore: prepare synthetic fixture')
    file.write_bytes(b'staged version\n')
    git(repo, 'add', '--', 'src/sample.txt')
    file.write_bytes(b'working version\n')
    return repo


def main():
    application = Path(os.environ['WINDOWS_APP_EXE'])
    native_driver = Path(os.environ['WINDOWS_EDGE_DRIVER'])
    output = Path('release-artifacts/windows-ui-proof')
    output.mkdir(parents=True, exist_ok=True)
    assert application.is_file() and native_driver.is_file()
    repo = prepare_repository()
    driver = Driver()
    log = (output / 'tauri-driver.log').open('w', encoding='utf-8')
    process = subprocess.Popen(['tauri-driver', '--native-driver', str(native_driver)], stdout=log, stderr=subprocess.STDOUT)
    try:
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            try:
                driver.request('GET', '/status', timeout=2)
                break
            except (OSError, WebDriverError):
                if process.poll() is not None:
                    raise RuntimeError('tauri-driver 启动失败')
                time.sleep(0.3)
        else:
            raise RuntimeError('tauri-driver 未准备好')
        driver.start(application)
        driver.click('.welcome-view button')
        driver.type('#repository-path', str(repo))
        driver.click('form.repository-open-form button[type="submit"]')
        driver.element('button[aria-label="已暂存：src/sample.txt"]')
        driver.element('button[aria-label="未暂存：src/sample.txt"]')
        driver.click('button[aria-label="暂存 src/sample.txt"]')
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            if git(repo, 'show', ':src/sample.txt').replace('\r\n', '\n') == 'working version\n':
                break
            time.sleep(0.3)
        else:
            raise RuntimeError('在界面暂存后，Git 索引内容未更新')
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            if driver.script('return !document.querySelector("#commit-message").disabled'):
                break
            time.sleep(0.3)
        else:
            raise RuntimeError('暂存完成后提交输入框仍不可用')
        driver.type('#commit-message', 'Windows smoke draft')
        driver.click('.sidebar-bottom .sidebar-action:first-child')
        driver.click('//label[.//input[@name="appearance-theme" and @value="light"]]', using='xpath')
        assert driver.script('return document.documentElement.dataset.theme') == 'light'
        driver.click('#interface-language option[value="en"]')
        assert driver.script('return document.documentElement.lang') == 'en'
        driver.screenshot(output / 'windows-settings.png')
        driver.click('[data-slot="dialog-close"]')
        assert driver.script('return document.querySelector("#commit-message").value') == 'Windows smoke draft'
        assert driver.element('button[aria-label="Generate commit message with AI"]')
        driver.screenshot(output / 'windows-workbench.png')
        assert git(repo, 'status', '--porcelain').strip() == 'M  src/sample.txt'
        (output / 'result.json').write_text(json.dumps({
            'installedAppStarted': True, 'openedSyntheticRepository': True,
            'stagedAndUnstagedShown': True, 'stagingUpdatedGitIndex': True,
            'themeAndLanguageChanged': True, 'commitDraftPreserved': True,
        }, indent=2) + '\n', encoding='utf-8')
        print('Windows 原生界面和虚构仓库操作验证通过。')
    except Exception:
        if driver.session:
            try:
                driver.screenshot(output / 'windows-error.png')
                (output / 'page.html').write_text(driver.request('GET', driver.path('/source')), encoding='utf-8')
            except Exception:
                pass
        raise
    finally:
        try:
            driver.close()
        except Exception:
            pass
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
        log.close()


if __name__ == '__main__':
    main()
