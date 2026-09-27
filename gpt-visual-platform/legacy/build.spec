# -*- mode: python ; coding: utf-8 -*-
# Unity MMORPG 自动化测试平台 - PyInstaller 构建配置
# 在目标系统上执行：pyinstaller build.spec
# 产出：dist/unity-test-platform/ 目录（内含可执行文件 + static）

import sys

block_cipher = None

# 将 static 打入包内（只读）；data 在运行时于可执行文件同目录创建（可写）
added_files = [
    ('static', 'static'),
]

a = Analysis(
    ['run_server.py'],
    pathex=[],
    binaries=[],
    datas=added_files,
    hiddenimports=[
        'uvicorn.logging',
        'uvicorn.loops',
        'uvicorn.loops.auto',
        'uvicorn.protocols',
        'uvicorn.protocols.http',
        'uvicorn.protocols.http.auto',
        'uvicorn.protocols.websockets',
        'uvicorn.protocols.websockets.auto',
        'uvicorn.lifespan',
        'uvicorn.lifespan.on',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='unity-test-platform',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
