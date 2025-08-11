#!/bin/bash

echo "🚀 强制使用C++17编译Windows版本..."

# 设置代理
export http_proxy=http://192.168.1.150:7890
export https_proxy=http://192.168.1.150:7890
export HTTP_PROXY=http://192.168.1.150:7890
export HTTPS_PROXY=http://192.168.1.150:7890

# 强制设置C++17标准和完全静态链接 - 覆盖所有可能的C++标准设置
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
echo "📋 当前C++编译设置："
echo "CXXFLAGS: $CXXFLAGS"
echo "CXX_FLAGS: $CXX_FLAGS"
echo "CMAKE_CXX_STANDARD: $CMAKE_CXX_STANDARD"
echo "DUCKDB_BUILD_FLAGS: $DUCKDB_BUILD_FLAGS"

echo "🔨 开始Windows交叉编译..."
cross build --target x86_64-pc-windows-gnu --release --verbose

if [ $? -eq 0 ]; then
    echo "✅ Windows编译成功！"
    echo "📁 可执行文件位置: target/x86_64-pc-windows-gnu/release/local_data_client.exe"
    
    # 显示文件信息
    ls -la target/x86_64-pc-windows-gnu/release/local_data_client.exe
    file target/x86_64-pc-windows-gnu/release/local_data_client.exe
    
    # 创建发布包
    mkdir -p release/windows
    cp target/x86_64-pc-windows-gnu/release/local_data_client.exe release/windows/
    cp -r static release/windows/
    
    echo "📦 Windows发布包已创建在 release/windows/ 目录"
    echo "🎉 编译完成！可以将release/windows/目录复制到Windows系统运行"
else
    echo "❌ Windows编译失败"
    echo "💡 可能的解决方案："
    echo "   1. 检查DuckDB是否支持强制C++17"
    echo "   2. 尝试使用不同版本的DuckDB"
    echo "   3. 考虑在Windows环境中直接编译"
fi
