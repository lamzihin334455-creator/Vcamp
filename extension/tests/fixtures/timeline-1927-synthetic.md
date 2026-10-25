# 32:07 时间定位夹具

`timeline-1927-synthetic.mp4` 是 64×36、1 fps、无音轨的黑帧视频，时长 1927 秒。用于验证本机原生播放器能实际定位 106.76、1186、1884.97 等秒数；不使用用户视频画面，不覆盖浏览器 duration 或 currentTime 的实现。

生成命令：

```powershell
ffmpeg -f lavfi -i color=c=black:s=64x36:r=1 -t 1927 -c:v libx264 -preset ultrafast -crf 45 -g 10 -pix_fmt yuv420p -an -movflags +faststart -n timeline-1927-synthetic.mp4
```
