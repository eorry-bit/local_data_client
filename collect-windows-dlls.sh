#!/bin/bash

echo "🔧 收集Windows运行时DLL..."

# 创建libs目录
mkdir -p release/windows/libs

echo "📚 复制必需的运行时库..."

# 复制C++标准库
echo "复制 libstdc++-6.dll..."
docker run --rm -v $(pwd):/workspace ghcr.io/cross-rs/x86_64-pc-windows-gnu:main \
    cp /usr/lib/gcc/x86_64-w64-mingw32/9.3-posix/libstdc++-6.dll /workspace/release/windows/libs/

# 复制pthread库
echo "复制 libwinpthread-1.dll..."
docker run --rm -v $(pwd):/workspace ghcr.io/cross-rs/x86_64-pc-windows-gnu:main \
    cp /usr/x86_64-w64-mingw32/lib/libwinpthread-1.dll /workspace/release/windows/libs/

# 复制GCC运行时库
echo "复制 libgcc_s_seh-1.dll..."
docker run --rm -v $(pwd):/workspace ghcr.io/cross-rs/x86_64-pc-windows-gnu:main \
    cp /usr/lib/gcc/x86_64-w64-mingw32/9.3-posix/libgcc_s_seh-1.dll /workspace/release/windows/libs/

# 检查是否还有其他可能需要的DLL
echo "🔍 检查其他可能需要的DLL..."

# 查找其他常见的MinGW DLL
COMMON_DLLS=(
    "libgomp-1.dll"
    "libquadmath-0.dll"
    "libssp-0.dll"
)

for dll in "${COMMON_DLLS[@]}"; do
    echo "查找 $dll..."
    if docker run --rm -v $(pwd):/workspace ghcr.io/cross-rs/x86_64-pc-windows-gnu:main \
        find /usr -name "$dll" -type f -exec cp {} /workspace/release/windows/libs/ \; 2>/dev/null; then
        echo "✅ 找到并复制了 $dll"
    else
        echo "⚠️ 未找到 $dll (可能不需要)"
    fi
done

echo "📊 libs目录内容:"
ls -la release/windows/libs/

echo "📏 DLL大小统计:"
du -sh release/windows/libs/*

echo "✅ DLL收集完成!"
echo "💡 现在可以使用 start-with-libs.bat 启动程序"
