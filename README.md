# Bug 优先级看板

一个零依赖、可直接挂到服务器上的社区 Bug 收集页。用户可提交新问题，也可在已有问题后留下 QQ 名增加权重。数据保存在 `data/bugs.json`。

`data/bugs.json` 是运行时数据，可能含有用户提交的内容，因此不会随本仓库发布；首次启动时服务会自动创建示例数据。

## 启动

需要 Node.js 18 或更高版本：

```bash
npm start
```

浏览器打开 `http://服务器IP:3000`。修改端口：

```bash
PORT=8080 npm start
```

Windows PowerShell：

```powershell
$env:PORT=8080; npm start
```

## 服务器部署

可用 Nginx/Caddy 反向代理到 `127.0.0.1:3000`，并用 PM2 或 systemd 常驻运行。请定期备份 `data/bugs.json`。

## 当前规则

- QQ 名是公开署名，不要求填写 QQ 号码。
- 同一个 QQ 名对同一问题只能加权一次。
- 排序以署名数量为主，权重相同时按提交时间排序。
- 相同标题不能重复提交。

## 许可证

本项目采用 [MIT License](LICENSE)。
