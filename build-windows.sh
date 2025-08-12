#!/bin/bash

echo "🚀 完整Windows编译 - C++17 + 完整DLL收集..."

# ==================== 清理和准备 ====================
echo "🧹 清理之前的构建..."
cargo clean
rm -rf release/windows/

# ==================== 代理设置 ====================
echo "🌐 设置代理..."
export http_proxy=http://192.168.1.150:7890
export https_proxy=http://192.168.1.150:7890
export HTTP_PROXY=http://192.168.1.150:7890
export HTTPS_PROXY=http://192.168.1.150:7890

# ==================== C++17强制编译设置 ====================
echo "⚙️ 设置C++17强制编译环境..."

# 强制设置C++17标准和完全静态链接 - 覆盖所有可能的C++标准设置
export CXXFLAGS="-std=c++17 -D_WIN32_WINNT=0x0A00 -DWINVER=0x0A00 -pthread -static-libgcc -static-libstdc++ -static -Wl,-Bstatic -lstdc++ -Wl,-Bdynamic"
export CFLAGS="-D_WIN32_WINNT=0x0A00 -DWINVER=0x0A00 -static-libgcc -static"
export LDFLAGS="-static-libgcc -static-libstdc++ -static -Wl,-Bstatic -lstdc++ -Wl,-Bdynamic"

# cc-rs特定的环境变量
export CXX_FLAGS="-std=c++17"
export CC_FLAGS="-std=c17"

# DuckDB构建相关的环境变量 - 强制C++17
export DUCKDB_BUILD_FLAGS="-std=c++17"
export CMAKE_CXX_STANDARD=17
export CMAKE_CXX_FLAGS="-std=c++17"
export LIBDUCKDB_SYS_CXXFLAGS="-std=c++17"
export DUCKDB_CXX_STANDARD="17"

# 编译器设置
export CC_x86_64_pc_windows_gnu="x86_64-w64-mingw32-gcc-posix"
export CXX_x86_64_pc_windows_gnu="x86_64-w64-mingw32-g++-posix"
export AR_x86_64_pc_windows_gnu="x86_64-w64-mingw32-ar"
export CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER="x86_64-w64-mingw32-gcc-posix"

# Rust链接标志 - 强制完全静态链接，包括libstdc++
export RUSTFLAGS="-C target-feature=+crt-static -C link-args=-static -C link-args=-static-libgcc -C link-args=-static-libstdc++ -C link-args=-lws2_32 -C link-args=-ladvapi32 -C link-args=-luserenv -C link-args=-lpthread"

# 显示当前设置
echo "📋 当前C++17编译设置："
echo "CXXFLAGS: $CXXFLAGS"
echo "CXX_FLAGS: $CXX_FLAGS"
echo "CMAKE_CXX_STANDARD: $CMAKE_CXX_STANDARD"
echo "DUCKDB_BUILD_FLAGS: $DUCKDB_BUILD_FLAGS"
echo "代理: $http_proxy"

# ==================== 开始编译 ====================
echo "🔨 开始Windows交叉编译 (强制C++17)..."
cross build --target x86_64-pc-windows-gnu --release --verbose

if [ $? -eq 0 ]; then
    echo "✅ Windows编译成功！"
    echo "📁 可执行文件位置: target/x86_64-pc-windows-gnu/release/local_data_client.exe"

    # 显示文件信息
    ls -la target/x86_64-pc-windows-gnu/release/local_data_client.exe
    file target/x86_64-pc-windows-gnu/release/local_data_client.exe

    # ==================== 创建发布包 ====================
    echo "📦 创建Windows发布包..."
    mkdir -p release/windows/libs

    # 复制主程序和静态文件
    cp target/x86_64-pc-windows-gnu/release/local_data_client.exe release/windows/
    cp -r static release/windows/

    # ==================== 收集所有运行时DLL ====================
    echo "📚 收集所有Windows运行时DLL..."

    # 必需的DLL列表
    REQUIRED_DLLS=(
        "libstdc++-6.dll:/usr/lib/gcc/x86_64-w64-mingw32/9.3-posix/libstdc++-6.dll"
        "libwinpthread-1.dll:/usr/x86_64-w64-mingw32/lib/libwinpthread-1.dll"
        "libgcc_s_seh-1.dll:/usr/lib/gcc/x86_64-w64-mingw32/9.3-posix/libgcc_s_seh-1.dll"
    )

    # 可选的DLL列表
    OPTIONAL_DLLS=(
        "libgomp-1.dll"
        "libquadmath-0.dll"
        "libssp-0.dll"
        "libatomic-1.dll"
    )

    # 复制必需的DLL
    echo "📋 复制必需的DLL..."
    for dll_info in "${REQUIRED_DLLS[@]}"; do
        dll_name=$(echo $dll_info | cut -d: -f1)
        dll_path=$(echo $dll_info | cut -d: -f2)

        echo "复制 $dll_name..."
        if docker run --rm -v $(pwd):/workspace ghcr.io/cross-rs/x86_64-pc-windows-gnu:main \
            cp "$dll_path" "/workspace/release/windows/libs/$dll_name" 2>/dev/null; then
            echo "✅ $dll_name 复制成功"
        else
            echo "❌ $dll_name 复制失败，尝试查找..."
            # 尝试查找DLL
            if docker run --rm -v $(pwd):/workspace ghcr.io/cross-rs/x86_64-pc-windows-gnu:main \
                find /usr -name "$dll_name" -type f -exec cp {} "/workspace/release/windows/libs/" \; 2>/dev/null; then
                echo "✅ $dll_name 通过查找复制成功"
            else
                echo "❌ $dll_name 未找到"
            fi
        fi
    done

    # 复制可选的DLL
    echo "📋 复制可选的DLL..."
    for dll in "${OPTIONAL_DLLS[@]}"; do
        echo "查找 $dll..."
        if docker run --rm -v $(pwd):/workspace ghcr.io/cross-rs/x86_64-pc-windows-gnu:main \
            find /usr -name "$dll" -type f -exec cp {} "/workspace/release/windows/libs/" \; 2>/dev/null; then
            echo "✅ $dll 找到并复制"
        else
            echo "⚠️ $dll 未找到 (可选)"
        fi
    done

    # 将所有DLL复制到主目录以确保兼容性
    echo "📋 将DLL复制到主目录..."
    if [ -d "release/windows/libs" ] && [ "$(ls -A release/windows/libs)" ]; then
        cp release/windows/libs/*.dll release/windows/ 2>/dev/null
        echo "✅ DLL已复制到主目录"
    else
        echo "⚠️ libs目录为空或不存在"
    fi

    # ==================== 创建启动脚本 ====================
    echo "📝 创建智能启动脚本..."
    cat > release/windows/start.bat << 'EOF'
@echo off
echo ========================================
echo   Local Data Client - Complete Package
echo ========================================
echo.

REM Get current directory
set SCRIPT_DIR=%~dp0

REM Check main program
if not exist "%SCRIPT_DIR%local_data_client.exe" (
    echo ERROR: Cannot find local_data_client.exe
    pause
    exit /b 1
)

echo Checking runtime libraries...

REM List of required DLLs
set REQUIRED_DLLS=libstdc++-6.dll libwinpthread-1.dll libgcc_s_seh-1.dll
set OPTIONAL_DLLS=libgomp-1.dll libquadmath-0.dll libssp-0.dll libatomic-1.dll

set MISSING_REQUIRED=0
set MISSING_OPTIONAL=0

REM Check required DLLs
for %%d in (%REQUIRED_DLLS%) do (
    if exist "%SCRIPT_DIR%%%d" (
        echo OK: Found %%d
    ) else (
        echo ERROR: Missing required DLL: %%d
        set /a MISSING_REQUIRED+=1
    )
)

REM Check optional DLLs
for %%d in (%OPTIONAL_DLLS%) do (
    if exist "%SCRIPT_DIR%%%d" (
        echo OK: Found %%d (optional)
    ) else (
        echo INFO: Optional DLL not found: %%d
        set /a MISSING_OPTIONAL+=1
    )
)

if %MISSING_REQUIRED% gtr 0 (
    echo.
    echo ERROR: %MISSING_REQUIRED% required DLL(s) missing
    echo.
    echo Solutions:
    echo 1. Ensure all files from release package are present
    echo 2. Install Microsoft Visual C++ Redistributable
    echo 3. Install MinGW-w64 runtime
    echo.
    pause
    exit /b 1
)

if %MISSING_OPTIONAL% gtr 0 (
    echo.
    echo INFO: %MISSING_OPTIONAL% optional DLL(s) missing (program should still work)
)

echo.
echo Setting up environment...

REM Add current directory to PATH
set PATH=%SCRIPT_DIR%;%PATH%

REM Change to script directory
cd /d "%SCRIPT_DIR%"

echo Starting Local Data Client...
echo After startup, visit: http://127.0.0.1:3000
echo Press Ctrl+C to stop server
echo ========================================
echo.

local_data_client.exe

echo.
echo Program exited
pause
EOF

    # ==================== 创建README ====================
    echo "📖 创建使用说明..."
    cat > release/windows/README.md << 'EOF'
# Local Data Client - Windows Complete Package

## Quick Start
1. Double-click `start.bat` to launch
2. Visit `http://127.0.0.1:3000` in browser

## Package Contents
- `local_data_client.exe` - Main application (C++17 compiled)
- `libstdc++-6.dll` - C++ standard library
- `libwinpthread-1.dll` - Windows pthread library
- `libgcc_s_seh-1.dll` - GCC runtime library
- `libgomp-1.dll` - OpenMP library (optional)
- `libquadmath-0.dll` - Quad precision math (optional)
- `libssp-0.dll` - Stack protection (optional)
- `libatomic-1.dll` - Atomic operations (optional)
- `libs/` - Runtime libraries directory
- `static/` - Web files (with local JS libraries)
- `start.bat` - Smart startup script

## System Requirements
- Windows 10/11 x64
- Memory: 512MB+ (2GB+ recommended)
- Port: 3000 (configurable)

## Features
- Multi-target data querying
- Data aggregation modes (1 second to 1 week)
- Reference value settings
- Excel export with pivot tables
- Real-time chart visualization
- Outlier detection (IQR/Z-Score)
- Data operations management

## Troubleshooting
If DLLs are missing:
1. Install Microsoft Visual C++ Redistributable
2. Install MinGW-w64 runtime
3. Ensure all files are in same directory
4. Run as administrator if needed

## Technical Details
- Compiled with C++17 standard
- DuckDB with C++17 support
- Complete runtime library package
- Self-contained deployment
EOF

    # ==================== 检查可执行文件依赖 ====================
    echo "🔍 检查可执行文件的实际依赖..."
    echo "使用objdump分析依赖:"
    docker run --rm -v $(pwd):/workspace ghcr.io/cross-rs/x86_64-pc-windows-gnu:main \
        x86_64-w64-mingw32-objdump -p /workspace/target/x86_64-pc-windows-gnu/release/local_data_client.exe | grep "DLL Name" || echo "无法获取依赖信息"

    # ==================== 显示最终结果 ====================
    echo ""
    echo "📊 Windows发布包内容:"
    echo "主目录:"
    ls -la release/windows/ | grep -E "\.(exe|dll|bat|md)$" || echo "无相关文件"

    echo ""
    echo "libs目录:"
    ls -la release/windows/libs/ 2>/dev/null || echo "libs目录不存在或为空"

    echo ""
    echo "📏 发布包大小:"
    du -sh release/windows/ 2>/dev/null || echo "无法计算大小"

    echo ""
    echo "🎉 Windows完整编译包创建成功！"
    echo "📁 位置: release/windows/"
    echo "💡 使用方法:"
    echo "   1. 将整个 release/windows/ 目录复制到Windows系统"
    echo "   2. 双击 start.bat 启动程序"
    echo "   3. 浏览器访问 http://127.0.0.1:3000"
    echo ""
    echo "✅ 特性:"
    echo "   - C++17编译的DuckDB"
    echo "   - 完整的运行时DLL包"
    echo "   - 智能启动脚本"
    echo "   - 零配置部署"

else
    echo "❌ Windows编译失败"
    echo "💡 可能的解决方案："
    echo "   1. 检查网络连接和代理设置"
    echo "   2. 确保cross工具已安装"
    echo "   3. 检查DuckDB C++17兼容性"
    echo "   4. 尝试清理cargo缓存: cargo clean"
fi
