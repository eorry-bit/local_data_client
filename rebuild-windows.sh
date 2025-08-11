#!/bin/bash

echo "🔄 完整重新编译Windows版本..."

# 清理之前的构建
echo "🧹 清理之前的构建..."
cargo clean
rm -rf release/windows/

# 设置代理
echo "🌐 设置代理..."
export http_proxy=http://192.168.1.150:7890
export https_proxy=http://192.168.1.150:7890
export HTTP_PROXY=http://192.168.1.150:7890
export HTTPS_PROXY=http://192.168.1.150:7890

# 强制设置C++17标准和完全静态链接
echo "⚙️ 设置编译环境..."
export CXXFLAGS="-std=c++17 -D_WIN32_WINNT=0x0A00 -DWINVER=0x0A00 -pthread -static-libgcc -static-libstdc++ -static -Wl,-Bstatic -lstdc++ -Wl,-Bdynamic"
export CFLAGS="-D_WIN32_WINNT=0x0A00 -DWINVER=0x0A00 -static-libgcc -static"
export LDFLAGS="-static-libgcc -static-libstdc++ -static -Wl,-Bstatic -lstdc++ -Wl,-Bdynamic"

# cc-rs特定的环境变量
export CXX_FLAGS="-std=c++17"
export CC_FLAGS="-std=c17"

# DuckDB构建相关的环境变量
export DUCKDB_BUILD_FLAGS="-std=c++17"
export CMAKE_CXX_STANDARD=17
export CMAKE_CXX_FLAGS="-std=c++17"

# 编译器设置
export CC_x86_64_pc_windows_gnu="x86_64-w64-mingw32-gcc-posix"
export CXX_x86_64_pc_windows_gnu="x86_64-w64-mingw32-g++-posix"
export AR_x86_64_pc_windows_gnu="x86_64-w64-mingw32-ar"
export CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER="x86_64-w64-mingw32-gcc-posix"

# Rust链接标志 - 强制完全静态链接，包括libstdc++
export RUSTFLAGS="-C target-feature=+crt-static -C link-args=-static -C link-args=-static-libgcc -C link-args=-static-libstdc++ -C link-args=-lws2_32 -C link-args=-ladvapi32 -C link-args=-luserenv -C link-args=-lpthread"

# 尝试覆盖libduckdb-sys的构建标志
export LIBDUCKDB_SYS_CXXFLAGS="-std=c++17"
export DUCKDB_CXX_STANDARD="17"

# 显示当前设置
echo "📋 当前编译设置："
echo "CXXFLAGS: $CXXFLAGS"
echo "RUSTFLAGS: $RUSTFLAGS"
echo "代理: $http_proxy"

echo "🔨 开始Windows交叉编译..."
cross build --target x86_64-pc-windows-gnu --release --verbose

if [ $? -eq 0 ]; then
    echo "✅ Windows编译成功！"
    echo "📁 可执行文件位置: target/x86_64-pc-windows-gnu/release/local_data_client.exe"
    
    # 显示文件信息
    ls -la target/x86_64-pc-windows-gnu/release/local_data_client.exe
    file target/x86_64-pc-windows-gnu/release/local_data_client.exe
    
    # 创建发布包
    echo "📦 创建Windows发布包..."
    mkdir -p release/windows
    cp target/x86_64-pc-windows-gnu/release/local_data_client.exe release/windows/
    cp -r static release/windows/
    
    # 复制必需的DLL
    echo "📚 复制运行时库..."
    if docker run --rm -v $(pwd):/workspace ghcr.io/cross-rs/x86_64-pc-windows-gnu:main cp /usr/lib/gcc/x86_64-w64-mingw32/9.3-posix/libstdc++-6.dll /workspace/release/windows/; then
        echo "✅ libstdc++-6.dll 复制成功"
    else
        echo "❌ libstdc++-6.dll 复制失败，尝试备用路径..."
        docker run --rm -v $(pwd):/workspace ghcr.io/cross-rs/x86_64-pc-windows-gnu:main cp /usr/lib/gcc/x86_64-w64-mingw32/9.3-win32/libstdc++-6.dll /workspace/release/windows/ || echo "⚠️ 无法复制DLL，请手动添加"
    fi
    
    # 创建启动脚本
    echo "📝 创建启动脚本..."
    cat > release/windows/start.bat << 'EOF'
@echo off
echo ========================================
echo   Local Data Client - Windows版本
echo ========================================
echo.

REM 检查文件是否存在
if not exist "local_data_client.exe" (
    echo 错误: 找不到 local_data_client.exe
    pause
    exit /b 1
)

if not exist "libstdc++-6.dll" (
    echo 错误: 找不到 libstdc++-6.dll
    pause
    exit /b 1
)

echo 正在启动 Local Data Client...
echo 启动后请访问: http://127.0.0.1:3000
echo 按 Ctrl+C 停止服务器
echo ========================================
echo.

local_data_client.exe

echo 程序已退出
pause
EOF
    
    # 创建README
    echo "📖 创建使用说明..."
    cat > release/windows/README.md << 'EOF'
# Local Data Client - Windows版本

## 使用方法
1. 双击 `start.bat` 启动程序
2. 浏览器访问 `http://127.0.0.1:3000`

## 文件说明
- `local_data_client.exe` - 主程序
- `libstdc++-6.dll` - C++运行时库
- `static/` - 网页文件
- `start.bat` - 启动脚本

## 系统要求
- Windows 10/11 x64
- 内存: 512MB+
- 端口: 3000 (可配置)
EOF
    
    echo "📊 发布包信息:"
    ls -la release/windows/
    du -sh release/windows/
    
    echo "🎉 Windows发布包创建完成！"
    echo "📁 位置: release/windows/"
    echo "💡 使用方法: 将整个 release/windows/ 目录复制到Windows系统运行"
    
else
    echo "❌ Windows编译失败"
    echo "💡 请检查错误信息并重试"
fi
