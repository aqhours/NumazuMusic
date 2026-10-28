# Yomikana

《君のこころは輝いてるかい？》日语歌词读本，包含假名注音、罗马音、中文释义、逐字同步高亮和自动滚动。

## 本地开发

需要 Node.js 22.13 或更高版本。

```bash
npm install
npm run dev
```

打开 `http://localhost:3000`。

网页版歌词播放界面支持上一首、播放/暂停和下一首；切歌与自动续播共用首页顺序（发行日期从早到晚，同日按曲目编号，完全相同则保留首页顺序），首尾循环。切歌保留阅读界面，只加载目标歌曲的歌词数据。

人工验收：打开 `/songs/kimi-no-kokoro` → 开始阅读，检查上一首/下一首、暂停后恢复、歌曲结束自动续播、最后一首回到第一首，以及手机端按钮布局。

歌词显示按钮（原罗马音开关）依次切换「完整注音 → 中日双语 → 仅中文」：完整注音包含罗马音与分词释义，中日双语保留日文假名和整句中文，仅中文只显示整句译文。网页和 Mac 主播放器共用此功能，播放器内切歌保留当前模式。人工验收时请连续点击三次确认循环，并检查仅中文模式的当前行高亮、自动跟随、点击歌词跳转，以及手机端「更多歌词功能」中的模式名称。

## 歌词卡片

在阅读器点击「导出歌词卡片」（手机端位于「更多歌词功能」），选择日语、中文或双语，再勾选 1–12 句歌词。支持不连续选句，按原歌词顺序输出；切换语言保留选中句子。日语卡片使用原文，不带假名、罗马音和分词释义。

卡片根据专辑封面已有色板生成明亮的纯色背景：默认「柔和」，「鲜明」增加色彩浓度，两档都保留封面色相、降低饱和度并提升明度，不叠加渐变。以加粗的大字号歌词为主体，顶部排列小尺寸专辑封面、歌名和艺人信息，使用深色文字保持清晰。歌名和艺人按实际字形左对齐，在封面右侧垂直居中，文字整体高度略低于封面；长名称自动折行，必要时等比例缩放。艺人名称使用加粗文字，保留完整成员说明及其他艺人署名。卡片底部独立放置「NumaZu Music」，左侧搭配同色实心耳机图标（加厚头梁、填满耳罩），整组与封面和歌词的左边缘对齐。署名采用矮、宽、粗的字形，优先使用 Arial Black，与艺人文字同色，无阴影。图片不含站点名称、网址或语言标签。预览与保存共用同一张无损 PNG，常规导出宽度为 2400 px，文字和图标按输出分辨率直接绘制；较长卡片自动调整分辨率，保证高度不超过 8000 px、总像素不超过 1600 万，图片高度随内容增加；长句自动折行，原歌词行之间保留间距。生成过程在本机完成，封面优先使用本地 640 px 素材并以高质量缩小，避免放大播放器的 256 px 缩略图；封面不可用时采用唱片图案；仅在封面色板缺失时退回中性浅灰。网页点击「保存图片」下载，也可长按预览图片保存；Mac 应用保存到系统下载文件夹，同名文件自动编号。自动切到下一首时，正在制作的卡片仍保留原歌曲。

人工验收入口：`/songs/kimi-no-kokoro` → 开始阅读 → 导出歌词卡片。请检查日语/中文/双语、选中与取消、两种样式、长句与最多 12 句的完整图片、连续快速切换后保存内容、手机横竖屏、全屏时打开/关闭、Esc 只关闭卡片，以及 Mac 重复保存不覆盖旧图片。界面及导出图片的视觉效果由人工验收。

## Mac 应用

Mac 版复用歌曲库与播放器，新增半透明黑底的桌面悬浮歌词，支持手柄拖动、字号调整、中日双语和鼠标穿透；Mac 播放模式为全曲库随机播放，悬浮窗可控制上一首、下一首和播放/暂停。要求 macOS 14+；安装 Rust 与 Xcode Command Line Tools 后，运行 `npm run mac:dev` 开发、`npm run mac:build` 打包。使用方法和人工验收清单见 [Mac 应用说明](docs/mac-app.md)。

## 检查

```bash
npm run lint
npm test
```

歌词时间轴位于 `public/audio/kimi-no-kokoro.yrc`，歌曲音频位于 `public/audio/kimi-no-kokoro.mp3`。

浏览器首次打开歌词阅读器时会下载完整音频并写入 Cache Storage；之后打开同一首歌会直接读取本地缓存。缓存不可用、被浏览器回收或存储空间不足时会自动退回在线播放，不影响播放器使用。更新已有音频文件时，请同步递增 `app/audio-cache.ts` 中的缓存版本号。

## 生产部署

生产环境运行在 `https://numazumusic.aqhours.cn`。旧域名 `https://yomikana.aqhours.cn` 保留路径和查询参数，以 308 跳转至新域名。推送到 `main` 后，GitHub webhook 会触发 `deploy.sh`，按该提交构建并更新服务。

## 专辑封面配色

歌词背景使用 `node-vibrant` 提取封面的 Vibrant、DarkVibrant、LightVibrant、Muted、DarkMuted、LightMuted 六类颜色。配色保存于 `app/cover-palettes.json`，浏览器无需下载提色库或执行图片分析。

添加或更新 `app/song-data.ts` 中的封面后，运行 `npm run palette:generate` 并提交生成的 JSON。该命令需要访问封面图床；支持 JPEG 和 WebP，提取失败时不会覆盖已有配色。歌词背景由 `@applemusic-like-lyrics/core` 的 `MeshGradientRenderer` 根据封面生成动态网格渐变；预生成配色继续用于进度条和兜底底色。边缘虚化只作用于可见文字，不处理背景。

## 加载优化

歌曲数据只在服务端组装，浏览器接收当前歌曲；首页列表在服务端渲染，只有主题按钮需要客户端交互。音频缓存下载在点击「开始阅读」后启动，避免与首屏图片争抢带宽。

歌曲详情页背景保留原始 URL、尺寸与画质。歌词动态背景使用同源封面缩略图作为颜色输入，桌面展示的大封面仍使用原图。首页卡片使用 640px WebP，播放器小封面使用 256px WebP，质量参数为 88；首页仅第一张封面立即加载，其余由浏览器按滚动位置懒加载。新增或更新 `app/song-data.ts` 中的封面后，运行 `npm run covers:optimize`，提交 `public/covers/` 下的生成图片与 `app/cover-thumbnails.json`。文件名包含内容哈希，常规构建不需要访问图床。

## 歌词动态背景

`app/reader-background.tsx` 在打开歌词页后动态加载 AMLL，采用 30 FPS、0.5 渲染比例和 0.2 流动速度。暂停或系统要求减少动态效果时使用静态模式；页面隐藏时暂停渲染，关闭歌词页后释放资源。图片加载或 WebGL 失败时退回静态模糊封面。Safari 页面底色保留封面深色兜底，移除了针对旧 CSS 渐变的颜色估算。

音频响应完整采用官方 `@applemusic-like-lyrics/fft@0.2.2`（WASM）：`AudioWorklet` 只负责采集播放音频的交织 PCM，交给 `FFTPlayer.pushDataF32()`；重采样、混音、加窗与 FFT 都由官方包处理。采用官方默认频段 80–2000 Hz、128 项频谱，每 50 ms 读取一次。随后复用 AMLL Player 的 `FFTToLowPassContext` 运算（前两项频谱、对数转换、10 项窗口和 0.003 帧时间平滑），按动画帧传给背景，不再叠加自定义增益、软压缩或起落参数。

`app/vendor/amll-fft-to-low-pass.ts` 从 [AMLL Player 固定版本 6d21991](https://github.com/amll-dev/amll-player/blob/6d21991731c2ad3217680872cee8ab556b4866a3/packages/player/src/components/LocalMusicContext/index.tsx#L60-L142) 提取：只替换 React/Jotai 外壳，保留原运算和窗口行为；许可证见 `app/vendor/AMLL-LICENSE`。网页适配负责首次播放手势中的 AudioContext 启动、暂停/跳转/后台的 PCM 清理及资源释放。分析支路不输出声音，不需要麦克风权限；分析加载失败时保留普通播放。Vite 使用 `vite-plugin-wasm` 打包官方 WASM，跨域直连兜底音频不启用分析。

非 UI 音频检查：`node --test tests/amll-fft.test.mjs`，验证官方 WASM 对 44.1/48 kHz PCM 的频谱分析，以及 PCM 交织、背压和跳转清理。

第三方依赖：FFT 使用 [@applemusic-like-lyrics/fft](https://github.com/amll-dev/fft) 0.2.2，npm 元数据标注 GPL-3.0，但随包 LICENSE 文本为 AGPL-3.0，保留上游原始声明与许可证。背景使用 [@applemusic-like-lyrics/core](https://github.com/amll-dev/applemusic-like-lyrics)，版本 0.5.2，许可证 AGPL-3.0-only（见依赖包 LICENSE）。

人工验收入口：`/songs/happy-party-train` → 开始阅读。请检查不同歌曲的色彩、播放/暂停、全屏切换、手机横竖屏、Safari 顶栏，以及关闭后重新打开。构建和 lint 不代表视觉验收通过。

## 致谢

感谢 [Apple Music-like Lyrics（AMLL）](https://github.com/amll-dev/applemusic-like-lyrics) 项目及其维护者和贡献者。Yomikana 的歌词动态背景使用了该项目提供的 `MeshGradientRenderer`、官方 FFT 包与播放器低频响应算法，让专辑封面的色彩以柔和流动的渐变呈现。感谢你们的开源分享与持续维护。
