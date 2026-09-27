"""
打包用入口：直接运行 app，避免 uvicorn 的 "main:app" 在打包后找不到模块。
Linux / Windows / Mac 均可运行：python run_server.py 或运行打包后的可执行文件。
端口固定为 9111。
"""
import uvicorn
from main import app

if __name__ == "__main__":
    print("正在启动服务: http://0.0.0.0:9111")
    uvicorn.run(app, host="0.0.0.0", port=9111)
