# 电脑与手机同步：部署指引

本仓库已经包含账号、同步 API 和 SQLite 存储；**仅打开 HTML 文件不会跨设备同步**。下面是一套以 Ubuntu 服务器、自有域名和 Caddy 为例的部署路径。还没有执行部署，也不需要现在购买服务器。公开给其他人注册使用之前，先做独立安全审查、限流与备份恢复演练。

## 1. 准备地址和运行环境

1. 准备一台持续在线、有持久化磁盘的服务器和一个域名，例如 `worktable.example.com`。在 DNS 中将该子域名的 A/AAAA 记录指向服务器。
2. 只对公网开放 TCP 80、443；应用服务的 8787 端口保持仅在服务器本机访问。
3. 按 [Node.js 官方下载页](https://nodejs.org/en/download) 安装 **Node.js 24 或更新版本**。用 `node --version` 和 `command -v node` 核对版本与可执行文件路径。应用使用 Node 自带的 `node:sqlite`，没有 npm 依赖。
4. 按 [Caddy 官方 Ubuntu 安装说明](https://caddyserver.com/docs/install#debian-ubuntu-raspbian) 安装 Caddy。它将接收 HTTPS 流量，再转发给本机的 Node 服务。

以下命令以 `/opt/everyday-worktable` 存放代码、`/var/lib/everyday-worktable/data` 存放数据库为例；替换示例域名和安装路径，不要把真实密码或个人备份放在代码仓库中。

## 2. 放置代码和数据目录

把审核通过的公开版文件复制到 `/opt/everyday-worktable`，确认 `server.js`、`index.html`、`app.js` 等文件在同一目录。创建一个不用于交互登录的运行账号及独立数据目录：

```sh
sudo useradd --system --create-home --home-dir /var/lib/everyday-worktable --shell /usr/sbin/nologin worktable
sudo mkdir -p /var/lib/everyday-worktable/data /var/lib/everyday-worktable/backups
sudo chown -R worktable:worktable /var/lib/everyday-worktable
sudo chmod 700 /var/lib/everyday-worktable/data /var/lib/everyday-worktable/backups
sudo chmod -R a+rX /opt/everyday-worktable
```

如果运行账号已经存在，就跳过 `useradd`。不要把 SQLite 数据目录放进 `/opt/everyday-worktable` 或未来的 Git 仓库。

## 3. 让 Node 服务常驻

创建 `/etc/systemd/system/everyday-worktable.service`，将 `ExecStart` 中的 `/usr/bin/node` 替换为 `command -v node` 的实际结果，并替换域名：

```ini
[Unit]
Description=Everyday Worktable
After=network.target

[Service]
Type=simple
User=worktable
Group=worktable
WorkingDirectory=/opt/everyday-worktable
Environment=NODE_ENV=production
Environment=HOST=127.0.0.1
Environment=PORT=8787
Environment=WORKTABLE_DATA_DIR=/var/lib/everyday-worktable/data
Environment=PUBLIC_ORIGIN=https://worktable.example.com
ExecStart=/usr/bin/node /opt/everyday-worktable/server.js
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/var/lib/everyday-worktable/data
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

启动并检查：

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now everyday-worktable
sudo systemctl status everyday-worktable
curl http://127.0.0.1:8787/api/me
```

最后一个命令应返回 `{"user":null}`；这只测试服务器本机访问，不是公网地址。

## 4. 配置 HTTPS

在 `/etc/caddy/Caddyfile` 中设置：

```caddyfile
worktable.example.com {
    reverse_proxy 127.0.0.1:8787
}
```

检查配置并重载：

```sh
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

当 DNS 已生效且 80/443 可达时，Caddy 会为域名自动处理 HTTPS。用电脑和手机分别打开 `https://worktable.example.com`，在「设置 → 跨设备同步」登录**同一个账号**。手机浏览器可再选择「添加到主屏幕」。不同域名、`http://127.0.0.1` 与 `file://` 各有独立的浏览器本地存储，不会自动互相读取。

## 5. 从当前本地预览迁移

若你已经在 `file:///.../index.html` 的公开版输入内容：先在那个页面「设置 → 导出 JSON」，妥善保管文件；再打开正式 HTTPS 地址，创建账号或登录，进入「设置 → 导入 JSON」。导入会把当前设备的内容加入同步流程，若账号中已有另一份数据，先分别导出备份，再决定保留哪份。**个人版工作台的数据不会自动进入公开版**，公开版也不接受个人版备份。

## 6. 验证和备份

1. 电脑端创建一条测试任务、完成一个打卡并记录心情，等「设置」显示“已同步”。
2. 手机端用同一地址、同一账号登录，确认任务、打卡、心情和知识卡片均出现；在手机修改后回到电脑刷新验证。
3. 两端离线时各自可继续本地记录。若出现版本冲突，界面会暂停同步并让你选择“云端”或“本机”；选择前先在两端分别导出 JSON，因为当前版本不自动合并冲突。
4. 定期备份 `/var/lib/everyday-worktable/data/worktable.sqlite`。数据库启用 WAL，不要在服务运行时只复制主 `.sqlite` 文件；可安装 `sqlite3` CLI，使用 `.backup` 生成一致性快照，例如：

```sh
sudo -u worktable sqlite3 /var/lib/everyday-worktable/data/worktable.sqlite ".backup '/var/lib/everyday-worktable/backups/worktable-backup.sqlite'"
```

将备份再复制到受保护的异地存储，定期在测试环境演练恢复。JSON 导出则是每个账号自己可持有的额外备份，不替代服务器数据库备份。升级服务前先备份数据库，再部署代码并重启服务。

## 上线边界

这是一套可测试的单机、单实例同步实现，不等于已经上线的托管服务。运行机器关机或网络不可达时，另一设备不能同步，但本机仍可保存；公共服务还需要安全审计、监控、垃圾注册防护、密码找回与数据删除政策。SQLite 的单机文件不应直接放在多台无共享协调的应用服务器上。

参考：[Caddy 自动 HTTPS](https://caddyserver.com/docs/automatic-https)、[Caddy 反向代理](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)、[PWA 安装条件](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)、[SQLite `.backup`](https://www.sqlite.org/cli.html)。
