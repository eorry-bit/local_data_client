// 全局变量
let filterOptions = {};
let currentData = [];
let referenceValues = []; // 存储参考值配置
let timeRanges = []; // 存储时间段配置

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', function() {
    initializeApp();
});

// 初始化应用
async function initializeApp() {
    try {
        await loadFilterOptions();
        setupEventListeners();
        setDefaultTimeRange();
        initializeChart();
    } catch (error) {
        showError('初始化失败: ' + error.message);
    }
}

// 加载筛选选项
async function loadFilterOptions() {
    try {
        const response = await fetch('/api/filters');
        const result = await response.json();
        
        if (!result.success) {
            throw new Error(result.error || '获取筛选选项失败');
        }
        
        filterOptions = result.data;
        populateAssetSelect();
        populateKeyNameSelect();
    } catch (error) {
        throw new Error('加载筛选选项失败: ' + error.message);
    }
}

// 填充资产选择器
function populateAssetSelect() {
    const assetSelect = document.getElementById('assetSelect');
    assetSelect.innerHTML = '<option value="">请选择资产...</option>';
    
    filterOptions.assets.forEach(asset => {
        const option = document.createElement('option');
        option.value = asset;
        option.textContent = asset;
        assetSelect.appendChild(option);
    });
}

// 填充数据类型复选框
function populateKeyNameSelect() {
    const keyNameCheckboxes = document.getElementById('keyNameCheckboxes');
    keyNameCheckboxes.innerHTML = '';

    if (filterOptions.key_names.length === 0) {
        keyNameCheckboxes.innerHTML = '<div class="info">没有可用的数据类型</div>';
        return;
    }

    filterOptions.key_names.forEach(keyName => {
        const checkboxItem = document.createElement('div');
        checkboxItem.className = 'checkbox-item';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = `keyname_${keyName}`;
        checkbox.value = keyName;

        const label = document.createElement('label');
        label.htmlFor = `keyname_${keyName}`;
        label.textContent = keyName;

        checkboxItem.appendChild(checkbox);
        checkboxItem.appendChild(label);
        keyNameCheckboxes.appendChild(checkboxItem);
    });
}

// 设置事件监听器
function setupEventListeners() {
    document.getElementById('assetSelect').addEventListener('change', onAssetChange);
    document.getElementById('deviceSelect').addEventListener('change', onDeviceChange);
    document.getElementById('removeOutliers').addEventListener('change', onOutlierToggle);
    document.getElementById('enableCustomFilter').addEventListener('change', onCustomFilterToggle);
    document.getElementById('enableTimeFilter').addEventListener('change', onTimeFilterToggle);
    document.getElementById('enablePerformanceMode').addEventListener('change', onPerformanceModeToggle);
}

// 异常值选项切换处理
function onOutlierToggle() {
    const removeOutliers = document.getElementById('removeOutliers').checked;
    const outlierMethod = document.getElementById('outlierMethod');
    outlierMethod.disabled = !removeOutliers;
}

// 自定义过滤选项切换处理
function onCustomFilterToggle() {
    const enableCustomFilter = document.getElementById('enableCustomFilter').checked;
    const minValue = document.getElementById('minValue');
    const maxValue = document.getElementById('maxValue');
    const excludeValues = document.getElementById('excludeValues');

    minValue.disabled = !enableCustomFilter;
    maxValue.disabled = !enableCustomFilter;
    excludeValues.disabled = !enableCustomFilter;

    if (!enableCustomFilter) {
        minValue.value = '';
        maxValue.value = '';
        excludeValues.value = '';
    }
}

// 时间段过滤选项切换处理
function onTimeFilterToggle() {
    const enableTimeFilter = document.getElementById('enableTimeFilter').checked;
    const configButton = document.getElementById('configTimeRanges');

    configButton.disabled = !enableTimeFilter;

    if (enableTimeFilter) {
        if (timeRanges.length === 0) {
            // 设置默认时间段
            timeRanges = [{ start: '07:00', end: '22:00' }];
        }
        // 移除自动弹窗提示
    }
}

// 数据聚合模式切换处理
function onPerformanceModeToggle() {
    const enablePerformanceMode = document.getElementById('enablePerformanceMode').checked;
    const dataLimit = document.getElementById('dataLimit');
    const samplingInterval = document.getElementById('samplingInterval');
    const samplingMethod = document.getElementById('samplingMethod');

    dataLimit.disabled = !enablePerformanceMode;
    samplingInterval.disabled = !enablePerformanceMode;
    samplingMethod.disabled = !enablePerformanceMode;

    if (enablePerformanceMode) {
        // 默认启用1万点限制和1小时平均值聚合
        dataLimit.value = '10000';
        samplingInterval.value = '3600000';
        samplingMethod.value = 'avg';
        // 移除自动弹窗提示
    } else {
        dataLimit.value = '';
        samplingInterval.value = '';
        samplingMethod.value = 'first';
    }
}

// 资产选择变化处理
async function onAssetChange() {
    const assetSelect = document.getElementById('assetSelect');
    const deviceSelect = document.getElementById('deviceSelect');
    const targetCheckboxes = document.getElementById('targetCheckboxes');
    
    // 重置设备和标靶选择
    deviceSelect.innerHTML = '<option value="">请选择设备...</option>';
    deviceSelect.disabled = true;
    targetCheckboxes.innerHTML = '<div class="info">请先选择设备以加载标靶列表</div>';
    
    if (!assetSelect.value) {
        return;
    }
    
    try {
        const response = await fetch(`/api/devices?asset_name=${encodeURIComponent(assetSelect.value)}`);
        const result = await response.json();
        
        if (!result.success) {
            throw new Error(result.error || '获取设备列表失败');
        }
        
        result.data.forEach(device => {
            const option = document.createElement('option');
            option.value = device;
            option.textContent = device;
            deviceSelect.appendChild(option);
        });
        
        deviceSelect.disabled = false;
    } catch (error) {
        showError('加载设备列表失败: ' + error.message);
    }
}

// 设备选择变化处理
async function onDeviceChange() {
    const assetSelect = document.getElementById('assetSelect');
    const deviceSelect = document.getElementById('deviceSelect');
    const targetCheckboxes = document.getElementById('targetCheckboxes');
    
    targetCheckboxes.innerHTML = '<div class="info">正在加载标靶列表...</div>';
    
    if (!deviceSelect.value) {
        targetCheckboxes.innerHTML = '<div class="info">请先选择设备以加载标靶列表</div>';
        return;
    }
    
    try {
        const response = await fetch(`/api/targets?asset_name=${encodeURIComponent(assetSelect.value)}&device_name=${encodeURIComponent(deviceSelect.value)}`);
        const result = await response.json();
        
        if (!result.success) {
            throw new Error(result.error || '获取标靶列表失败');
        }
        
        targetCheckboxes.innerHTML = '';
        
        if (result.data.length === 0) {
            targetCheckboxes.innerHTML = '<div class="info">该设备下没有标靶数据</div>';
            return;
        }
        
        result.data.forEach(target => {
            const checkboxItem = document.createElement('div');
            checkboxItem.className = 'checkbox-item';
            
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.id = `target_${target}`;
            checkbox.value = target;
            
            const label = document.createElement('label');
            label.htmlFor = `target_${target}`;
            label.textContent = target;
            
            checkboxItem.appendChild(checkbox);
            checkboxItem.appendChild(label);
            targetCheckboxes.appendChild(checkboxItem);
        });
    } catch (error) {
        showError('加载标靶列表失败: ' + error.message);
        targetCheckboxes.innerHTML = '<div class="error">加载标靶列表失败</div>';
    }
}

// 设置默认时间范围（最近24小时）
function setDefaultTimeRange() {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    
    document.getElementById('endTime').value = formatDateTimeLocal(now);
    document.getElementById('startTime').value = formatDateTimeLocal(yesterday);
}

// 格式化日期时间为本地格式
function formatDateTimeLocal(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    
    return `${year}-${month}-${day}T${hours}:${minutes}`;
}

// 初始化图表
function initializeChart() {
    const layout = {
        title: {
            text: '遥测数据时序图表',
            font: { size: 18 }
        },
        xaxis: {
            title: '时间',
            type: 'date',
            tickformat: '%Y/%m/%d %H:%M:%S',
            hoverformat: '%Y/%m/%d %H:%M:%S'
        },
        yaxis: {
            title: '位移（mm）'
        },
        hovermode: 'x unified',
        showlegend: true,
        legend: {
            orientation: 'h',
            y: -0.2
        },
        margin: {
            l: 60,
            r: 30,
            t: 60,
            b: 100
        }
    };

    const config = {
        responsive: true,
        displayModeBar: true,
        modeBarButtonsToRemove: ['pan2d', 'lasso2d', 'select2d'],
        displaylogo: false,
        locale: 'zh-CN'
    };

    Plotly.newPlot('chart', [], layout, config);
}

// 加载数据
async function loadData() {
    const assetName = document.getElementById('assetSelect').value;
    const deviceName = document.getElementById('deviceSelect').value;
    const startTime = document.getElementById('startTime').value;
    const endTime = document.getElementById('endTime').value;
    const removeOutliers = document.getElementById('removeOutliers').checked;
    const outlierMethod = document.getElementById('outlierMethod').value;
    const enableCustomFilter = document.getElementById('enableCustomFilter').checked;
    const minValue = document.getElementById('minValue').value;
    const maxValue = document.getElementById('maxValue').value;
    const excludeValues = document.getElementById('excludeValues').value;
    const enablePerformanceMode = document.getElementById('enablePerformanceMode').checked;
    const dataLimit = document.getElementById('dataLimit').value;
    const samplingInterval = document.getElementById('samplingInterval').value;
    const samplingMethod = document.getElementById('samplingMethod').value;
    const enableTimeFilter = document.getElementById('enableTimeFilter').checked;
    
    // 获取选中的标靶
    const selectedTargets = [];
    const targetCheckboxes = document.querySelectorAll('#targetCheckboxes input[type="checkbox"]:checked');
    targetCheckboxes.forEach(checkbox => {
        selectedTargets.push(checkbox.value);
    });

    // 获取选中的数据类型
    const selectedKeyNames = [];
    const keyNameCheckboxes = document.querySelectorAll('#keyNameCheckboxes input[type="checkbox"]:checked');
    keyNameCheckboxes.forEach(checkbox => {
        selectedKeyNames.push(checkbox.value);
    });
    
    // 验证必填字段
    if (!assetName || !deviceName || selectedKeyNames.length === 0 || selectedTargets.length === 0) {
        showError('请选择资产、设备、至少一个数据类型和至少一个标靶');
        return;
    }
    
    if (!startTime || !endTime) {
        showError('请选择时间范围');
        return;
    }
    
    showLoading(true);
    hideError();
    
    try {
        const params = new URLSearchParams({
            asset_name: assetName,
            device_name: deviceName,
            key_names: selectedKeyNames.join(','),
            target_names: selectedTargets.join(','),
            start_time: new Date(startTime).toISOString(),
            end_time: new Date(endTime).toISOString(),
            remove_outliers: removeOutliers.toString(),
            outlier_method: outlierMethod
        });

        // 添加自定义过滤参数
        if (enableCustomFilter) {
            if (minValue) params.append('min_value', minValue);
            if (maxValue) params.append('max_value', maxValue);
            if (excludeValues) params.append('exclude_values', excludeValues);
        }

        // 添加数据聚合参数
        if (enablePerformanceMode) {
            if (dataLimit) params.append('limit', dataLimit);
            if (samplingInterval) {
                params.append('sampling_interval', samplingInterval);
                params.append('sampling_method', samplingMethod);
            }
        }

        // 添加参考值参数
        if (referenceValues.length > 0) {
            params.append('reference_values', JSON.stringify(referenceValues));
        }

        // 添加时间段过滤参数
        if (enableTimeFilter && timeRanges.length > 0) {
            params.append('time_ranges', JSON.stringify(timeRanges));
        }
        
        const response = await fetch(`/api/telemetry?${params}`);
        const result = await response.json();
        
        if (!result.success) {
            throw new Error(result.error || '获取数据失败');
        }
        
        currentData = result.data.data;
        updateDataStats(result.data.stats);
        updateChart();
        updateExportButton();

    } catch (error) {
        showError('加载数据失败: ' + error.message);
    } finally {
        showLoading(false);
    }
}

// 流式加载数据（用于大数据量）
async function loadDataStream() {
    const assetName = document.getElementById('assetSelect').value;
    const deviceName = document.getElementById('deviceSelect').value;
    const startTime = document.getElementById('startTime').value;
    const endTime = document.getElementById('endTime').value;
    const removeOutliers = document.getElementById('removeOutliers').checked;
    const outlierMethod = document.getElementById('outlierMethod').value;
    const enablePerformanceMode = document.getElementById('enablePerformanceMode').checked;
    const dataLimit = document.getElementById('dataLimit').value;
    
    // 获取选中的标靶和数据类型
    const selectedTargets = [];
    const targetCheckboxes = document.querySelectorAll('#targetCheckboxes input[type="checkbox"]:checked');
    targetCheckboxes.forEach(checkbox => {
        selectedTargets.push(checkbox.value);
    });
    
    const selectedKeyNames = [];
    const keyNameCheckboxes = document.querySelectorAll('#keyNameCheckboxes input[type="checkbox"]:checked');
    keyNameCheckboxes.forEach(checkbox => {
        selectedKeyNames.push(checkbox.value);
    });
    
    if (selectedTargets.length === 0 || selectedKeyNames.length === 0) {
        showError('请至少选择一个标靶和一个数据类型');
        return;
    }
    
    // 构建查询参数
    const params = new URLSearchParams();
    if (assetName) params.append('asset_name', assetName);
    if (deviceName) params.append('device_name', deviceName);
    params.append('target_names', selectedTargets.join(','));
    params.append('key_names', selectedKeyNames.join(','));
    if (startTime) params.append('start_time', new Date(startTime).toISOString());
    if (endTime) params.append('end_time', new Date(endTime).toISOString());
    if (removeOutliers) {
        params.append('remove_outliers', 'true');
        params.append('outlier_method', outlierMethod);
    }
    if (enablePerformanceMode && dataLimit) {
        params.append('limit', dataLimit);
    }
    
    showLoading(true);
    currentData = [];
    let loadedCount = 0;
    
    try {
        // 使用EventSource进行流式接收
        const eventSource = new EventSource('/api/telemetry/stream?' + params.toString());
        
        eventSource.onmessage = function(event) {
            const message = JSON.parse(event.data);
            
            if (message.type === 'data') {
                // 接收到数据项
                currentData.push(message.item);
                loadedCount++;
                
                // 每接收100条数据更新一次图表
                if (loadedCount % 100 === 0) {
                    updateChart();
                    showLoadingProgress(`已加载 ${loadedCount} 条数据...`);
                }
            } else if (message.type === 'progress') {
                // 更新进度
                showLoadingProgress(`已加载 ${message.loaded} 条数据...`);
            } else if (message.type === 'stats') {
                // 接收完成，显示统计信息
                eventSource.close();
                showLoading(false);
                updateChart();
                updateExportButton();
                
                if (message.limited) {
                    showInfo(`已加载 ${message.total} 条数据（达到限制）`);
                } else {
                    showInfo(`加载完成，共 ${message.total} 条数据`);
                }
            } else if (message.type === 'error') {
                // 处理错误
                eventSource.close();
                showLoading(false);
                showError('加载数据失败: ' + message.message);
            }
        };
        
        eventSource.onerror = function(error) {
            eventSource.close();
            showLoading(false);
            showError('流式加载失败，请尝试普通加载模式');
        };
        
    } catch (error) {
        showLoading(false);
        showError('流式加载失败: ' + error.message);
    }
}

// 更新图表
function updateChart() {
    if (currentData.length === 0) {
        showError('没有找到符合条件的数据');
        return;
    }
    
    // 按标靶和数据类型组合分组数据
    const groupedData = {};
    const allGroupKeys = [];
    
    // 先收集所有的组合键，保证颜色分配的一致性
    currentData.forEach(item => {
        const groupKey = `${item.target_name}-${item.key_name}`;
        if (!allGroupKeys.includes(groupKey)) {
            allGroupKeys.push(groupKey);
        }
    });
    
    // 对组合键排序，确保颜色分配稳定
    allGroupKeys.sort();
    
    // 定义颜色调色板（更丰富的颜色）
    const colorPalette = [
        '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd',
        '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf',
        '#aec7e8', '#ffbb78', '#98df8a', '#ff9896', '#c5b0d5',
        '#c49c94', '#f7b6d2', '#c7c7c7', '#dbdb8d', '#9edae5'
    ];
    
    // 收集所有数据类型用于标题
    const keyNamesSet = new Set();
    
    currentData.forEach(item => {
        const groupKey = `${item.target_name}-${item.key_name}`;
        keyNamesSet.add(item.key_name);
        
        if (!groupedData[groupKey]) {
            // 每个组合使用不同的颜色
            const colorIndex = allGroupKeys.indexOf(groupKey);
            const color = colorPalette[colorIndex % colorPalette.length];
            
            groupedData[groupKey] = {
                x: [],
                y: [],
                name: `${item.target_name} (${item.key_name})`,
                type: 'scatter',
                mode: 'lines+markers',
                line: { 
                    width: 2,
                    color: color
                },
                marker: { 
                    size: 4,
                    color: color
                },
                hovertemplate: '<b>%{fullData.name}</b><br>' +
                              '时间: %{x|%Y/%m/%d %H:%M:%S}<br>' +
                              '位移（mm）: %{y}<br>' +
                              '<extra></extra>'
            };
        }
        groupedData[groupKey].x.push(new Date(item.timestamp));
        groupedData[groupKey].y.push(item.value);
    });
    
    // 转换为数组并排序，用于标题显示
    const keyNamesList = Array.from(keyNamesSet).sort();
    
    const traces = Object.values(groupedData);
    
    // 动态生成标题，包含所有选中的数据类型
    const keyNamesDisplay = keyNamesList.join(', ');
    const layout = {
        title: {
            text: `${currentData[0].asset_name} - ${currentData[0].device_name} - [${keyNamesDisplay}]`,
            font: { size: 18 }
        },
        xaxis: {
            title: '时间',
            type: 'date',
            tickformat: '%Y/%m/%d %H:%M:%S',
            hoverformat: '%Y/%m/%d %H:%M:%S'
        },
        yaxis: {
            title: '位移（mm）'
        },
        hovermode: 'x unified',
        showlegend: true,
        legend: {
            orientation: 'h',
            y: -0.2
        },
        margin: {
            l: 60,
            r: 30,
            t: 60,
            b: 100
        }
    };
    
    Plotly.react('chart', traces, layout);
}

// 清空图表
function clearChart() {
    currentData = [];
    initializeChart();
    hideError();
    hideDataStats();
    updateExportButton();
}

// 导出Excel功能
function exportToExcel() {
    if (currentData.length === 0) {
        showError('没有数据可以导出');
        return;
    }

    try {
        // 准备原始数据
        const excelData = currentData.map(item => ({
            '时间': formatDateForExcel(new Date(item.timestamp)),
            '资产名称': item.asset_name,
            '设备名称': item.device_name,
            '标靶名称': item.target_name,
            '数据类型': item.key_name,
            '位移（mm）': item.value
        }));

        // 创建数据透视表（行转列格式）
        const pivotData = createPivotTable(currentData);
        
        // 创建统计透视表
        const statisticsData = createStatisticsPivotTable(currentData);

        // 创建统计汇总表
        const summaryData = createSummaryTable(currentData);

        // 创建工作簿
        const wb = XLSX.utils.book_new();

        // 原始数据工作表
        const ws1 = XLSX.utils.json_to_sheet(excelData);
        const colWidths1 = [
            { wch: 20 }, // 时间
            { wch: 15 }, // 资产名称
            { wch: 15 }, // 设备名称
            { wch: 15 }, // 标靶名称
            { wch: 15 }, // 数据类型
            { wch: 12 }  // 数值
        ];
        ws1['!cols'] = colWidths1;
        XLSX.utils.book_append_sheet(wb, ws1, '原始数据');

        // 数据透视表工作表（行转列格式）
        const ws2 = XLSX.utils.json_to_sheet(pivotData);
        // 动态设置列宽：第一列时间列较宽，其他数据列标准宽度
        const colWidths2 = [{ wch: 20 }]; // 时间列
        // 为每个数据列设置宽度
        for (let i = 1; i < Object.keys(pivotData[0] || {}).length; i++) {
            colWidths2.push({ wch: 15 });
        }
        ws2['!cols'] = colWidths2;
        XLSX.utils.book_append_sheet(wb, ws2, '数据透视表');
        
        // 统计透视表工作表
        const ws3 = XLSX.utils.json_to_sheet(statisticsData);
        const colWidths3 = [
            { wch: 15 }, // 标靶名称
            { wch: 15 }, // 数据类型
            { wch: 12 }, // 数据点数
            { wch: 12 }, // 平均值
            { wch: 12 }, // 最大值
            { wch: 12 }, // 最小值
            { wch: 12 }, // 标准差
            { wch: 20 }, // 最早时间
            { wch: 20 }  // 最晚时间
        ];
        ws3['!cols'] = colWidths3;
        XLSX.utils.book_append_sheet(wb, ws3, '统计分析');

        // 统计汇总工作表
        const ws4 = XLSX.utils.json_to_sheet(summaryData);
        const colWidths4 = [
            { wch: 20 }, // 统计项
            { wch: 15 }  // 值
        ];
        ws4['!cols'] = colWidths4;
        XLSX.utils.book_append_sheet(wb, ws4, '统计汇总');

        // 生成包含标靶和指标信息的文件名
        const targets = [...new Set(currentData.map(item => item.target_name))];
        const keyNames = [...new Set(currentData.map(item => item.key_name))];
        
        // 限制文件名长度，避免过长
        let targetStr = targets.slice(0, 3).join('-');
        if (targets.length > 3) {
            targetStr += `等${targets.length}个`;
        }
        
        let keyStr = keyNames.slice(0, 2).join('-');
        if (keyNames.length > 2) {
            keyStr += `等${keyNames.length}个`;
        }
        
        // 组合文件名：资产_设备_标靶_指标_时间
        const now = new Date();
        const fileName = `遥测数据_${currentData[0].asset_name}_${currentData[0].device_name}_${targetStr}_${keyStr}_${formatDateForFilename(now)}.xlsx`;

        // 导出文件
        XLSX.writeFile(wb, fileName);

        // 显示成功消息
        showSuccess(`数据已成功导出到 ${fileName}，包含原始数据、数据透视表和统计汇总`);
    } catch (error) {
        showError('导出Excel失败: ' + error.message);
    }
}

// 格式化日期用于Excel显示
function formatDateForExcel(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');

    return `${year}/${month}/${day} ${hours}:${minutes}:${seconds}`;
}

// 格式化日期用于文件名
function formatDateForFilename(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');

    return `${year}${month}${day}_${hours}${minutes}`;
}

// 显示HTML导出设置模态框
function exportToHTML() {
    if (currentData.length === 0) {
        showError('没有数据可以导出');
        return;
    }
    
    // 生成默认标题
    const keyNamesList = [...new Set(currentData.map(item => item.key_name))].sort();
    const keyNamesDisplay = keyNamesList.join(', ');
    const defaultTitle = `${currentData[0].asset_name} - ${currentData[0].device_name} - [${keyNamesDisplay}]`;
    
    // 设置默认值
    document.getElementById('chartTitle').value = '';
    document.getElementById('chartTitle').placeholder = defaultTitle;
    document.getElementById('reportTitle').value = '位移分析报告';
    document.getElementById('reportDescription').value = '';
    
    // 显示模态框
    document.getElementById('exportHTMLModal').style.display = 'block';
}

// 隐藏HTML导出模态框
function hideExportHTMLModal() {
    document.getElementById('exportHTMLModal').style.display = 'none';
}

// 确认导出HTML
async function confirmExportHTML() {
    hideExportHTMLModal();
    
    try {
        // 读取本地的Plotly库内容
        showLoading(true);
        showLoadingProgress('正在生成HTML报告...');
        
        let plotlyScript = '';
        try {
            // 获取本地Plotly库内容
            const response = await fetch('/libs/plotly.min.js');
            if (response.ok) {
                plotlyScript = await response.text();
            } else {
                // 如果无法获取本地文件，使用CDN作为后备
                plotlyScript = `document.write('<script src="https://cdn.plot.ly/plotly-2.27.0.min.js"><\\/script>');`;
            }
        } catch (error) {
            console.warn('无法读取本地Plotly库，将使用CDN:', error);
            plotlyScript = `document.write('<script src="https://cdn.plot.ly/plotly-2.27.0.min.js"><\\/script>');`;
        }
        // 按标靶和数据类型组合分组数据（与updateChart相同的逻辑）
        const groupedData = {};
        const allGroupKeys = [];
        
        // 先收集所有的组合键，保证颜色分配的一致性
        currentData.forEach(item => {
            const groupKey = `${item.target_name}-${item.key_name}`;
            if (!allGroupKeys.includes(groupKey)) {
                allGroupKeys.push(groupKey);
            }
        });
        
        // 对组合键排序，确保颜色分配稳定
        allGroupKeys.sort();
        
        // 定义颜色调色板（更丰富的颜色）
        const colorPalette = [
            '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd',
            '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf',
            '#aec7e8', '#ffbb78', '#98df8a', '#ff9896', '#c5b0d5',
            '#c49c94', '#f7b6d2', '#c7c7c7', '#dbdb8d', '#9edae5'
        ];
        
        // 收集所有数据类型用于标题
        const keyNamesSet = new Set();
        
        currentData.forEach(item => {
            const groupKey = `${item.target_name}-${item.key_name}`;
            keyNamesSet.add(item.key_name);
            
            if (!groupedData[groupKey]) {
                // 每个组合使用不同的颜色
                const colorIndex = allGroupKeys.indexOf(groupKey);
                const color = colorPalette[colorIndex % colorPalette.length];
                
                groupedData[groupKey] = {
                    x: [],
                    y: [],
                    name: `${item.target_name} (${item.key_name})`,
                    type: 'scatter',
                    mode: 'lines+markers',
                    line: { 
                        width: 2,
                        color: color
                    },
                    marker: { 
                        size: 4,
                        color: color
                    },
                    hovertemplate: '<b>%{fullData.name}</b><br>' +
                                  '时间: %{x|%Y/%m/%d %H:%M:%S}<br>' +
                                  '位移（mm）: %{y}<br>' +
                                  '<extra></extra>'
                };
            }
            groupedData[groupKey].x.push(new Date(item.timestamp));
            groupedData[groupKey].y.push(item.value);
        });
        
        // 转换为数组并排序，用于标题显示
        const keyNamesList = Array.from(keyNamesSet).sort();
        
        const traces = Object.values(groupedData);
        
        // 动态生成标题，包含所有选中的数据类型
        const keyNamesDisplay = keyNamesList.join(', ');
        
        // 获取用户自定义的标题，如果为空则使用默认标题
        const customChartTitle = document.getElementById('chartTitle').value.trim();
        const defaultChartTitle = `${currentData[0].asset_name} - ${currentData[0].device_name} - [${keyNamesDisplay}]`;
        const chartTitleText = customChartTitle || defaultChartTitle;
        
        const layout = {
            title: {
                text: chartTitleText,
                font: { size: 18 }
            },
            xaxis: {
                title: '时间',
                type: 'date',
                tickformat: '%Y/%m/%d %H:%M:%S',
                hoverformat: '%Y/%m/%d %H:%M:%S'
            },
            yaxis: {
                title: '位移（mm）'
            },
            hovermode: 'x unified',
            showlegend: true,
            legend: {
                orientation: 'h',
                y: -0.2
            },
            margin: {
                l: 60,
                r: 30,
                t: 60,
                b: 100
            }
        };

        const config = {
            responsive: true,
            displayModeBar: true,
            modeBarButtonsToRemove: ['pan2d', 'lasso2d', 'select2d'],
            displaylogo: false,
            locale: 'zh-CN'
        };

        // 创建数据统计表
        const statsHtml = createHTMLStatsTable(currentData);

        // 获取用户自定义的报告标题和描述
        const customReportTitle = document.getElementById('reportTitle').value.trim() || '遥测数据分析报告';
        const reportDescription = document.getElementById('reportDescription').value.trim();
        
        // 生成HTML内容
        const htmlContent = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${customReportTitle} - ${formatDateForFilename(new Date())}</title>
    <!-- Plotly库已内嵌，支持完全离线使用 -->
    <script>${plotlyScript}</script>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            margin: 0;
            padding: 20px;
            background-color: #f5f5f5;
        }
        .container {
            max-width: 1400px;
            margin: 0 auto;
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            overflow: hidden;
        }
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 20px;
            text-align: center;
        }
        .header h1 {
            margin: 0;
            font-size: 28px;
            font-weight: 300;
        }
        .report-info {
            padding: 15px 20px;
            background: #fafafa;
            border-bottom: 1px solid #e0e0e0;
            font-size: 14px;
            color: #666;
        }
        .chart-container {
            padding: 20px;
            min-height: 600px;
        }
        .stats-section {
            padding: 20px;
            background: #f8f9fa;
            border-top: 1px solid #dee2e6;
        }
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 15px;
            margin-top: 15px;
        }
        .stat-card {
            background: white;
            padding: 15px;
            border-radius: 6px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        .stat-label {
            font-size: 12px;
            color: #666;
            margin-bottom: 5px;
        }
        .stat-value {
            font-size: 20px;
            font-weight: bold;
            color: #333;
        }
        .data-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 20px;
        }
        .data-table th {
            background: #667eea;
            color: white;
            padding: 10px;
            text-align: left;
            font-weight: 500;
        }
        .data-table td {
            padding: 8px 10px;
            border-bottom: 1px solid #e0e0e0;
        }
        .data-table tr:hover {
            background: #f5f5f5;
        }
        .footer {
            padding: 15px 20px;
            background: #fafafa;
            border-top: 1px solid #e0e0e0;
            text-align: center;
            font-size: 12px;
            color: #666;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>${customReportTitle}</h1>
        </div>
        
        <div class="report-info">
            <strong>生成时间：</strong>${formatDateForExcel(new Date())} | 
            <strong>数据点数：</strong>${currentData.length.toLocaleString()} | 
            <strong>资产：</strong>${currentData[0].asset_name} | 
            <strong>设备：</strong>${currentData[0].device_name}
            ${reportDescription ? `<div style="margin-top: 10px; padding: 10px; background: #e8f4fd; border-radius: 4px;"><strong>备注：</strong>${reportDescription}</div>` : ''}
        </div>
        
        <div class="chart-container">
            <div id="myChart"></div>
        </div>
        
        <div class="stats-section">
            <h2 style="margin-top: 0; color: #333;">数据统计分析</h2>
            ${statsHtml}
        </div>
        
        <div class="footer">
            <p>本报告由遥测数据可视化系统自动生成 | 导出时间：${formatDateForExcel(new Date())}</p>
        </div>
    </div>
    
    <script>
        // 图表数据
        const data = ${JSON.stringify(traces)};
        const layout = ${JSON.stringify(layout)};
        const config = ${JSON.stringify(config)};
        
        // 渲染图表
        Plotly.newPlot('myChart', data, layout, config);
        
        // 响应式调整
        window.addEventListener('resize', function() {
            Plotly.Plots.resize('myChart');
        });
    </script>
</body>
</html>`;

        // 生成包含标靶和指标信息的文件名
        const targets = [...new Set(currentData.map(item => item.target_name))];
        const keyNames = [...new Set(currentData.map(item => item.key_name))];
        
        // 限制文件名长度，避免过长
        let targetStr = targets.slice(0, 3).join('-');
        if (targets.length > 3) {
            targetStr += `等${targets.length}个`;
        }
        
        let keyStr = keyNames.slice(0, 2).join('-');
        if (keyNames.length > 2) {
            keyStr += `等${keyNames.length}个`;
        }
        
        // 组合文件名：资产_设备_标靶_指标_时间
        const fileName = `遥测数据_${currentData[0].asset_name}_${currentData[0].device_name}_${targetStr}_${keyStr}_${formatDateForFilename(new Date())}.html`;
        
        // 创建Blob并下载
        const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        showLoading(false);
        showSuccess('HTML报告已成功导出（完全离线版本，可直接分享）');
    } catch (error) {
        showLoading(false);
        showError('导出HTML失败: ' + error.message);
    }
}

// 创建HTML统计表格
function createHTMLStatsTable(data) {
    // 按标靶和数据类型分组统计
    const pivotMap = new Map();

    data.forEach(item => {
        const key = `${item.target_name}_${item.key_name}`;
        if (!pivotMap.has(key)) {
            pivotMap.set(key, {
                target_name: item.target_name,
                key_name: item.key_name,
                values: [],
                timestamps: []
            });
        }
        pivotMap.get(key).values.push(item.value);
        pivotMap.get(key).timestamps.push(new Date(item.timestamp));
    });

    // 计算统计信息
    const statsRows = [];
    pivotMap.forEach((group, key) => {
        const values = group.values;
        const timestamps = group.timestamps;

        if (values.length > 0) {
            const sum = values.reduce((a, b) => a + b, 0);
            const avg = sum / values.length;
            const max = Math.max(...values);
            const min = Math.min(...values);
            const stdDev = Math.sqrt(values.reduce((sq, n) => sq + Math.pow(n - avg, 2), 0) / values.length);

            statsRows.push({
                target: group.target_name,
                key: group.key_name,
                count: values.length,
                avg: avg.toFixed(3),
                max: max.toFixed(3),
                min: min.toFixed(3),
                stdDev: stdDev.toFixed(3),
                range: (max - min).toFixed(3)
            });
        }
    });

    // 生成统计表格HTML
    let tableHtml = `
        <table class="data-table">
            <thead>
                <tr>
                    <th>标靶名称</th>
                    <th>数据类型</th>
                    <th>数据点数</th>
                    <th>平均值(mm)</th>
                    <th>最大值(mm)</th>
                    <th>最小值(mm)</th>
                    <th>标准差</th>
                    <th>极差(mm)</th>
                </tr>
            </thead>
            <tbody>`;
    
    statsRows.forEach(row => {
        tableHtml += `
                <tr>
                    <td>${row.target}</td>
                    <td>${row.key}</td>
                    <td>${row.count.toLocaleString()}</td>
                    <td>${row.avg}</td>
                    <td>${row.max}</td>
                    <td>${row.min}</td>
                    <td>${row.stdDev}</td>
                    <td>${row.range}</td>
                </tr>`;
    });
    
    tableHtml += `
            </tbody>
        </table>`;
    
    // 生成总体统计卡片
    const timestamps = data.map(item => new Date(item.timestamp));
    const values = data.map(item => item.value);
    const targets = [...new Set(data.map(item => item.target_name))];
    const keyNames = [...new Set(data.map(item => item.key_name))];
    
    const minTime = new Date(Math.min(...timestamps));
    const maxTime = new Date(Math.max(...timestamps));
    const timeSpan = (maxTime - minTime) / (1000 * 60 * 60); // 小时
    
    const overallAvg = values.reduce((a, b) => a + b, 0) / values.length;
    const overallMax = Math.max(...values);
    const overallMin = Math.min(...values);
    
    const statsCards = `
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-label">总数据点</div>
                <div class="stat-value">${data.length.toLocaleString()}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">时间跨度</div>
                <div class="stat-value">${timeSpan.toFixed(1)} 小时</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">标靶数量</div>
                <div class="stat-value">${targets.length}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">数据类型</div>
                <div class="stat-value">${keyNames.length}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">总体平均值</div>
                <div class="stat-value">${overallAvg.toFixed(3)} mm</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">总体极差</div>
                <div class="stat-value">${(overallMax - overallMin).toFixed(3)} mm</div>
            </div>
        </div>`;
    
    return statsCards + tableHtml;
}

// 创建数据透视表
function createPivotTable(data) {
    // 创建行转列的数据透视表
    // 时间为行，标靶-数据类型组合为列
    
    // 1. 收集所有唯一的时间点和列名
    const timeMap = new Map(); // 时间 -> {列名 -> 值}
    const columnNames = new Set(); // 所有唯一的列名
    
    data.forEach(item => {
        // 格式化时间（精确到分钟或小时，根据数据密度）
        const timeStr = formatDateForExcel(new Date(item.timestamp));
        const columnName = `${item.target_name}-${item.key_name}`;
        
        columnNames.add(columnName);
        
        if (!timeMap.has(timeStr)) {
            timeMap.set(timeStr, {});
        }
        
        // 如果同一时间有多个值，取平均值
        if (timeMap.get(timeStr)[columnName]) {
            const existing = timeMap.get(timeStr)[columnName];
            timeMap.get(timeStr)[columnName] = (existing + item.value) / 2;
        } else {
            timeMap.get(timeStr)[columnName] = item.value;
        }
    });
    
    // 2. 将列名排序
    const sortedColumns = Array.from(columnNames).sort();
    
    // 3. 构建透视表数据
    const pivotData = [];
    
    // 将时间排序
    const sortedTimes = Array.from(timeMap.keys()).sort();
    
    sortedTimes.forEach(time => {
        const row = { '时间': time };
        const timeData = timeMap.get(time);
        
        // 为每个列添加值，如果没有值则留空
        sortedColumns.forEach(col => {
            row[col] = timeData[col] !== undefined ? parseFloat(timeData[col].toFixed(3)) : '';
        });
        
        pivotData.push(row);
    });
    
    return pivotData;
}

// 创建传统的统计透视表（保留原功能）
function createStatisticsPivotTable(data) {
    const pivotMap = new Map();

    // 按标靶名称和数据类型分组统计
    data.forEach(item => {
        const key = `${item.target_name}_${item.key_name}`;
        if (!pivotMap.has(key)) {
            pivotMap.set(key, {
                target_name: item.target_name,
                key_name: item.key_name,
                values: [],
                timestamps: []
            });
        }
        pivotMap.get(key).values.push(item.value);
        pivotMap.get(key).timestamps.push(new Date(item.timestamp));
    });

    // 计算统计信息
    const pivotData = [];
    pivotMap.forEach((group, key) => {
        const values = group.values;
        const timestamps = group.timestamps;

        if (values.length > 0) {
            const sum = values.reduce((a, b) => a + b, 0);
            const avg = sum / values.length;
            const max = Math.max(...values);
            const min = Math.min(...values);
            const stdDev = Math.sqrt(values.reduce((sq, n) => sq + Math.pow(n - avg, 2), 0) / values.length);
            const minTime = new Date(Math.min(...timestamps));
            const maxTime = new Date(Math.max(...timestamps));

            pivotData.push({
                '标靶名称': group.target_name,
                '数据类型': group.key_name,
                '数据点数': values.length,
                '平均值': parseFloat(avg.toFixed(3)),
                '最大值': max,
                '最小值': min,
                '标准差': parseFloat(stdDev.toFixed(3)),
                '最早时间': formatDateForExcel(minTime),
                '最晚时间': formatDateForExcel(maxTime)
            });
        }
    });

    return pivotData.sort((a, b) => a['标靶名称'].localeCompare(b['标靶名称']));
}

// 创建统计汇总表
function createSummaryTable(data) {
    if (data.length === 0) {
        return [{ '统计项': '无数据', '值': '-' }];
    }

    const timestamps = data.map(item => new Date(item.timestamp));
    const values = data.map(item => item.value);
    const targets = [...new Set(data.map(item => item.target_name))];
    const keyNames = [...new Set(data.map(item => item.key_name))];

    const minTime = new Date(Math.min(...timestamps));
    const maxTime = new Date(Math.max(...timestamps));
    const timeSpan = (maxTime - minTime) / (1000 * 60 * 60); // 小时

    const sum = values.reduce((a, b) => a + b, 0);
    const avg = sum / values.length;
    const max = Math.max(...values);
    const min = Math.min(...values);

    return [
        { '统计项': '总数据点数', '值': data.length.toLocaleString() },
        { '统计项': '标靶数量', '值': targets.length },
        { '统计项': '数据类型数量', '值': keyNames.length },
        { '统计项': '时间跨度', '值': `${timeSpan.toFixed(1)} 小时` },
        { '统计项': '开始时间', '值': formatDateForExcel(minTime) },
        { '统计项': '结束时间', '值': formatDateForExcel(maxTime) },
        { '统计项': '位移（mm）平均值', '值': avg.toFixed(3) },
        { '统计项': '位移（mm）最大值', '值': max },
        { '统计项': '位移（mm）最小值', '值': min },
        { '统计项': '位移（mm）范围', '值': (max - min).toFixed(3) }
    ];
}

// 更新导出按钮状态
function updateExportButton() {
    const exportBtn = document.getElementById('exportBtn');
    const exportHTMLBtn = document.getElementById('exportHTMLBtn');
    exportBtn.disabled = currentData.length === 0;
    if (exportHTMLBtn) {
        exportHTMLBtn.disabled = currentData.length === 0;
    }
}

// 更新数据统计显示
function updateDataStats(stats) {
    const dataStatsDiv = document.getElementById('dataStats');
    const totalDataPoints = document.getElementById('totalDataPoints');
    const timeRange = document.getElementById('timeRange');
    const targetCount = document.getElementById('targetCount');
    const outlierStats = document.getElementById('outlierStats');
    const outlierMethod = document.getElementById('outlierMethod');
    const removedOutliers = document.getElementById('removedOutliers');

    // 显示基本统计信息
    totalDataPoints.textContent = stats.total_points.toLocaleString();
    targetCount.textContent = stats.target_count;

    // 显示时间范围
    if (stats.time_range) {
        const startTime = new Date(stats.time_range[0]);
        const endTime = new Date(stats.time_range[1]);
        timeRange.textContent = `${formatDateForDisplay(startTime)} 至 ${formatDateForDisplay(endTime)}`;
    } else {
        timeRange.textContent = '-';
    }

    // 显示异常值统计
    if (stats.outliers_removed !== null && stats.outliers_removed !== undefined) {
        outlierStats.style.display = 'block';
        outlierMethod.textContent = stats.outlier_method === 'iqr' ? 'IQR方法 (四分位距)' : 'Z-Score方法 (标准差)';
        removedOutliers.textContent = `${stats.outliers_removed} 个数据点`;

        // 如果移除了异常值，显示提示
        if (stats.outliers_removed > 0) {
            showSuccess(`已使用${outlierMethod.textContent}移除 ${stats.outliers_removed} 个异常数据点`);
        }
    } else {
        outlierStats.style.display = 'none';
    }

    // 显示统计信息面板
    dataStatsDiv.style.display = 'block';
}

// 格式化日期用于显示
function formatDateForDisplay(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');

    return `${year}/${month}/${day} ${hours}:${minutes}`;
}

// 隐藏数据统计
function hideDataStats() {
    document.getElementById('dataStats').style.display = 'none';
}

// 显示/隐藏加载状态
function showLoading(show) {
    document.getElementById('loading').style.display = show ? 'block' : 'none';
}

// 显示加载进度
function showLoadingProgress(message) {
    const loadingDiv = document.getElementById('loading');
    if (loadingDiv.style.display === 'block') {
        loadingDiv.textContent = message;
    }
}

// 显示信息提示
function showInfo(message) {
    const infoDiv = document.getElementById('info');
    if (infoDiv) {
        infoDiv.textContent = message;
        infoDiv.style.display = 'block';
        setTimeout(() => {
            infoDiv.style.display = 'none';
        }, 5000);
    }
}

// 显示错误信息
function showError(message) {
    const errorDiv = document.getElementById('error');
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
    hideSuccess();
}

// 隐藏错误信息
function hideError() {
    document.getElementById('error').style.display = 'none';
}

// 显示成功信息
function showSuccess(message) {
    // 创建成功消息元素（如果不存在）
    let successDiv = document.getElementById('success');
    if (!successDiv) {
        successDiv = document.createElement('div');
        successDiv.id = 'success';
        successDiv.className = 'success';
        successDiv.style.cssText = `
            background: #d4edda;
            border: 1px solid #c3e6cb;
            color: #155724;
            padding: 15px;
            border-radius: 4px;
            margin: 10px 0;
            display: none;
        `;
        document.getElementById('error').parentNode.insertBefore(successDiv, document.getElementById('error'));
    }

    successDiv.textContent = message;
    successDiv.style.display = 'block';
    hideError();

    // 3秒后自动隐藏成功消息
    setTimeout(() => {
        hideSuccess();
    }, 3000);
}

// 隐藏成功信息
function hideSuccess() {
    const successDiv = document.getElementById('success');
    if (successDiv) {
        successDiv.style.display = 'none';
    }
}

// 参考值管理功能
function showReferenceValueModal() {
    document.getElementById('referenceValueModal').style.display = 'block';
    renderReferenceValueList();
}

function hideReferenceValueModal() {
    document.getElementById('referenceValueModal').style.display = 'none';
}

function addReferenceValue() {
    referenceValues.push({
        target_name: '',
        key_name: '',
        reference_value: 0
    });
    renderReferenceValueList();
}

function removeReferenceValue(index) {
    referenceValues.splice(index, 1);
    renderReferenceValueList();
}

function renderReferenceValueList() {
    const container = document.getElementById('referenceValueList');
    container.innerHTML = '';

    if (referenceValues.length === 0) {
        container.innerHTML = '<p>暂无参考值配置，点击"添加参考值"开始配置。</p>';
        return;
    }

    referenceValues.forEach((refVal, index) => {
        const item = document.createElement('div');
        item.className = 'reference-value-item';

        item.innerHTML = `
            <select onchange="updateReferenceValue(${index}, 'target_name', this.value)">
                <option value="">选择标靶...</option>
                ${filterOptions.targets ? filterOptions.targets.map(target =>
                    `<option value="${target}" ${refVal.target_name === target ? 'selected' : ''}>${target}</option>`
                ).join('') : ''}
            </select>
            <select onchange="updateReferenceValue(${index}, 'key_name', this.value)">
                <option value="">选择指标...</option>
                ${filterOptions.key_names ? filterOptions.key_names.map(keyName =>
                    `<option value="${keyName}" ${refVal.key_name === keyName ? 'selected' : ''}>${keyName}</option>`
                ).join('') : ''}
            </select>
            <input type="number" step="any" placeholder="参考值" value="${refVal.reference_value}"
                   onchange="updateReferenceValue(${index}, 'reference_value', parseFloat(this.value) || 0)">
            <button class="remove-btn" onclick="removeReferenceValue(${index})">删除</button>
        `;

        container.appendChild(item);
    });
}

function updateReferenceValue(index, field, value) {
    if (referenceValues[index]) {
        referenceValues[index][field] = value;
    }
}

function saveReferenceValues() {
    // 验证参考值配置
    const validRefs = referenceValues.filter(ref =>
        ref.target_name && ref.key_name && ref.reference_value !== undefined
    );

    if (validRefs.length !== referenceValues.length) {
        showError('请完整填写所有参考值配置');
        return;
    }

    // 保存到localStorage
    localStorage.setItem('referenceValues', JSON.stringify(referenceValues));

    hideReferenceValueModal();
    showSuccess(`已保存 ${referenceValues.length} 个参考值配置`);
}

// 页面加载时恢复参考值配置
function loadReferenceValues() {
    const saved = localStorage.getItem('referenceValues');
    if (saved) {
        try {
            referenceValues = JSON.parse(saved);
        } catch (e) {
            referenceValues = [];
        }
    }
}

// 时间段管理功能
function showTimeRangeModal() {
    document.getElementById('timeRangeModal').style.display = 'block';
    renderTimeRangeList();
}

function hideTimeRangeModal() {
    document.getElementById('timeRangeModal').style.display = 'none';
}

function addTimeRange() {
    timeRanges.push({ start: '09:00', end: '17:00' });
    renderTimeRangeList();
}

function removeTimeRange(index) {
    timeRanges.splice(index, 1);
    renderTimeRangeList();
}

function renderTimeRangeList() {
    const container = document.getElementById('timeRangeList');
    container.innerHTML = '';

    if (timeRanges.length === 0) {
        container.innerHTML = '<p>暂无时间段配置，点击"添加时间段"开始配置。</p>';
        return;
    }

    timeRanges.forEach((range, index) => {
        const item = document.createElement('div');
        item.className = 'reference-value-item';

        item.innerHTML = `
            <label>开始时间:</label>
            <input type="time" value="${range.start}" onchange="updateTimeRange(${index}, 'start', this.value)">
            <label>结束时间:</label>
            <input type="time" value="${range.end}" onchange="updateTimeRange(${index}, 'end', this.value)">
            <button class="remove-btn" onclick="removeTimeRange(${index})">删除</button>
        `;

        container.appendChild(item);
    });
}

function updateTimeRange(index, field, value) {
    if (timeRanges[index]) {
        timeRanges[index][field] = value;
    }
}

function setPresetTimeRanges(preset) {
    switch (preset) {
        case 'work':
            timeRanges = [
                { start: '09:00', end: '12:00' },
                { start: '14:00', end: '18:00' }
            ];
            break;
        case 'peak':
            timeRanges = [
                { start: '08:00', end: '10:00' },
                { start: '17:00', end: '19:00' }
            ];
            break;
        case 'night':
            timeRanges = [
                { start: '22:00', end: '06:00' }
            ];
            break;
    }
    renderTimeRangeList();
}

function saveTimeRanges() {
    // 验证时间段配置
    const validRanges = timeRanges.filter(range =>
        range.start && range.end
    );

    if (validRanges.length !== timeRanges.length) {
        showError('请完整填写所有时间段配置');
        return;
    }

    // 保存到localStorage
    localStorage.setItem('timeRanges', JSON.stringify(timeRanges));

    hideTimeRangeModal();
    showSuccess(`已保存 ${timeRanges.length} 个时间段配置`);
}

// 页面加载时恢复时间段配置
function loadTimeRanges() {
    const saved = localStorage.getItem('timeRanges');
    if (saved) {
        try {
            timeRanges = JSON.parse(saved);
        } catch (e) {
            timeRanges = [];
        }
    }
}

// 页面加载时初始化
document.addEventListener('DOMContentLoaded', function() {
    setupEventListeners();
    initializeChart();
    loadFilterOptions();
    setDefaultTimeRange();
    loadReferenceValues();
    loadTimeRanges();
});

// 数据操作管理功能
let dataOperations = [];
let editingOperationId = null;

function showDataOperationsModal() {
    document.getElementById('dataOperationsModal').style.display = 'block';
    populateQuickSelects();
    refreshOperationsList();
}

// 显示新增操作表单
function showAddOperationForm() {
    editingOperationId = null;
    document.getElementById('operationFormTitle').textContent = '新增数据操作';
    document.getElementById('operationId').value = '';
    document.getElementById('operationName').value = '';
    document.getElementById('operationDescription').value = '';
    document.getElementById('operationType').value = 'add';
    document.getElementById('operationValue').value = '';
    document.getElementById('operationStartTime').value = '';
    document.getElementById('operationEndTime').value = '';
    
    // 填充选择器
    populateOperationSelects();
    
    // 清空选择
    document.getElementById('operationTarget').value = '';
    document.getElementById('operationKey').value = '';
    
    // 显示表单
    document.getElementById('operationForm').style.display = 'block';
}

function hideDataOperationsModal() {
    document.getElementById('dataOperationsModal').style.display = 'none';
    hideAdvancedForm();
}

function toggleAdvancedForm() {
    const form = document.getElementById('advancedForm');
    form.style.display = form.style.display === 'none' ? 'block' : 'none';
}

function hideAdvancedForm() {
    document.getElementById('advancedForm').style.display = 'none';
    document.getElementById('operationId').value = '';
    document.getElementById('operationName').value = '';
    document.getElementById('operationDescription').value = '';
    document.getElementById('operationStartTime').value = '';
    document.getElementById('operationEndTime').value = '';
}

function populateQuickSelects() {
    // 填充快速添加的选择器
    const targetSelect = document.getElementById('quickTarget');
    const keySelect = document.getElementById('quickKey');
    
    targetSelect.innerHTML = '<option value="">选择标靶</option>';
    if (filterOptions.targets) {
        filterOptions.targets.forEach(target => {
            const option = document.createElement('option');
            option.value = target;
            option.textContent = target;
            targetSelect.appendChild(option);
        });
    }
    
    keySelect.innerHTML = '<option value="">选择指标</option>';
    if (filterOptions.key_names) {
        filterOptions.key_names.forEach(key => {
            const option = document.createElement('option');
            option.value = key;
            option.textContent = key;
            keySelect.appendChild(option);
        });
    }
}

// 快速添加操作
async function quickAddOperation() {
    const targetName = document.getElementById('quickTarget').value;
    const keyName = document.getElementById('quickKey').value;
    const operationType = document.getElementById('quickOperation').value;
    const value = parseFloat(document.getElementById('quickValue').value);
    
    if (!targetName || !keyName || isNaN(value)) {
        showError('请填写必要字段');
        return;
    }
    
    const operationData = {
        name: null,  // 自动生成
        description: null,
        target_name: targetName,
        key_name: keyName,
        operation_type: operationType,
        value,
        start_time: null,
        end_time: null
    };
    
    try {
        const response = await fetch('/api/operations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(operationData)
        });
        
        const result = await response.json();
        
        if (result.success) {
            // 清空快速添加表单
            document.getElementById('quickValue').value = '';
            refreshOperationsList();
            showSuccess('操作添加成功');
        } else {
            showError('添加失败: ' + result.error);
        }
    } catch (error) {
        showError('添加失败: ' + error.message);
    }
}

// 保存高级设置的操作
async function saveAdvancedOperation() {
    const targetName = document.getElementById('quickTarget').value;
    const keyName = document.getElementById('quickKey').value;
    const operationType = document.getElementById('quickOperation').value;
    const value = parseFloat(document.getElementById('quickValue').value);
    
    const name = document.getElementById('operationName').value.trim() || null;
    const description = document.getElementById('operationDescription').value.trim() || null;
    const startTime = document.getElementById('operationStartTime').value;
    const endTime = document.getElementById('operationEndTime').value;
    
    if (!targetName || !keyName || isNaN(value)) {
        showError('请填写必要字段');
        return;
    }
    
    const operationData = {
        name,
        description,
        target_name: targetName,
        key_name: keyName,
        operation_type: operationType,
        value,
        start_time: startTime ? new Date(startTime).toISOString() : null,
        end_time: endTime ? new Date(endTime).toISOString() : null
    };
    
    try {
        const editId = document.getElementById('operationId').value;
        let response;
        
        if (editId) {
            // 更新操作
            operationData.id = parseInt(editId);  // 添加id字段
            operationData.is_active = true;
            response = await fetch(`/api/operations/${editId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(operationData)
            });
        } else {
            // 创建新操作
            response = await fetch('/api/operations', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(operationData)
            });
        }
        
        const result = await response.json();
        
        if (result.success) {
            hideAdvancedForm();
            refreshOperationsList();
            showSuccess(editId ? '操作更新成功' : '操作创建成功');
        } else {
            showError('保存失败: ' + result.error);
        }
    } catch (error) {
        showError('保存失败: ' + error.message);
    }
}

function populateOperationSelects() {
    // 填充标靶选择器
    const targetSelect = document.getElementById('operationTarget');
    targetSelect.innerHTML = '<option value="">请选择标靶...</option>';
    if (filterOptions.targets) {
        filterOptions.targets.forEach(target => {
            const option = document.createElement('option');
            option.value = target;
            option.textContent = target;
            targetSelect.appendChild(option);
        });
    }
    
    // 填充指标选择器
    const keySelect = document.getElementById('operationKey');
    keySelect.innerHTML = '<option value="">请选择指标...</option>';
    if (filterOptions.key_names) {
        filterOptions.key_names.forEach(key => {
            const option = document.createElement('option');
            option.value = key;
            option.textContent = key;
            keySelect.appendChild(option);
        });
    }
}

async function refreshOperationsList() {
    try {
        const response = await fetch('/api/operations');
        const result = await response.json();
        
        if (result.success) {
            dataOperations = result.data;
            renderOperationsList();
        } else {
            showError('获取操作列表失败: ' + result.error);
        }
    } catch (error) {
        showError('获取操作列表失败: ' + error.message);
    }
}

function renderOperationsList() {
    const tbody = document.getElementById('operationsTableBody');
    
    if (dataOperations.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="padding: 20px; text-align: center; color: #999;">暂无数据操作记录</td></tr>';
        return;
    }
    
    tbody.innerHTML = dataOperations.map(op => {
        const operationSymbol = {
            'Add': '+',
            'Subtract': '-',
            'Multiply': '×',
            'Divide': '÷'
        }[op.operation_type] || '?';
        
        // 生成操作描述（紧凑显示）
        const displayName = op.name || `${op.key_name} ${operationSymbol} ${op.value}`;
        const hasTimeRange = op.start_time || op.end_time;
        const timeIndicator = hasTimeRange ? ' 📅' : '';
        
        return `
            <tr style="${!op.is_active ? 'opacity: 0.5;' : ''}">
                <td style="padding: 6px; border-bottom: 1px solid #eee; text-align: center;">
                    <input type="checkbox" ${op.is_active ? 'checked' : ''} 
                           onchange="toggleOperation(${op.id})"
                           title="${op.is_active ? '点击停用' : '点击启用'}">
                </td>
                <td style="padding: 6px; border-bottom: 1px solid #eee;">
                    <strong>${displayName}</strong>${timeIndicator}
                    ${op.description ? `<br><small style="color: #666;">${op.description}</small>` : ''}
                </td>
                <td style="padding: 6px; border-bottom: 1px solid #eee;">${op.target_name}</td>
                <td style="padding: 6px; border-bottom: 1px solid #eee;">
                    ${op.key_name} <span style="font-weight: bold;">${operationSymbol}</span> ${op.value}
                </td>
                <td style="padding: 6px; border-bottom: 1px solid #eee; text-align: center;">
                    <button class="btn btn-sm" onclick="quickEditOperation(${op.id})" style="padding: 2px 8px; font-size: 12px;" title="编辑">✏️</button>
                    <button class="btn btn-sm" onclick="deleteOperation(${op.id})" style="padding: 2px 8px; font-size: 12px; background: #dc3545; color: white;" title="删除">🗑️</button>
                </td>
            </tr>
        `;
    }).join('');
}

// 快速编辑操作
function quickEditOperation(id) {
    const operation = dataOperations.find(op => op.id === id);
    if (!operation) return;
    
    // 填充快速编辑表单
    document.getElementById('quickTarget').value = operation.target_name;
    document.getElementById('quickKey').value = operation.key_name;
    document.getElementById('quickOperation').value = operation.operation_type.toLowerCase();
    document.getElementById('quickValue').value = operation.value;
    
    // 如果有高级设置，填充并显示高级表单
    if (operation.name || operation.description || operation.start_time || operation.end_time) {
        document.getElementById('operationId').value = id;
        document.getElementById('operationName').value = operation.name || '';
        document.getElementById('operationDescription').value = operation.description || '';
        
        if (operation.start_time) {
            const startDate = new Date(operation.start_time);
            // 格式化为本地时间
            const year = startDate.getFullYear();
            const month = String(startDate.getMonth() + 1).padStart(2, '0');
            const day = String(startDate.getDate()).padStart(2, '0');
            const hours = String(startDate.getHours()).padStart(2, '0');
            const minutes = String(startDate.getMinutes()).padStart(2, '0');
            document.getElementById('operationStartTime').value = `${year}-${month}-${day}T${hours}:${minutes}`;
        } else {
            document.getElementById('operationStartTime').value = '';
        }
        
        if (operation.end_time) {
            const endDate = new Date(operation.end_time);
            const year = endDate.getFullYear();
            const month = String(endDate.getMonth() + 1).padStart(2, '0');
            const day = String(endDate.getDate()).padStart(2, '0');
            const hours = String(endDate.getHours()).padStart(2, '0');
            const minutes = String(endDate.getMinutes()).padStart(2, '0');
            document.getElementById('operationEndTime').value = `${year}-${month}-${day}T${hours}:${minutes}`;
        } else {
            document.getElementById('operationEndTime').value = '';
        }
        
        document.getElementById('advancedForm').style.display = 'block';
    }
}

function formatTimeRange(startTime, endTime) {
    if (!startTime && !endTime) {
        return '全时段';
    }
    
    const formatDate = (dateStr) => {
        if (!dateStr) return '';
        const date = new Date(dateStr);
        return date.toLocaleString('zh-CN', { 
            year: 'numeric', 
            month: '2-digit', 
            day: '2-digit', 
            hour: '2-digit', 
            minute: '2-digit' 
        });
    };
    
    if (startTime && endTime) {
        return `${formatDate(startTime)} 至 ${formatDate(endTime)}`;
    } else if (startTime) {
        return `从 ${formatDate(startTime)} 开始`;
    } else {
        return `至 ${formatDate(endTime)}`;
    }
}

async function saveOperation() {
    const name = document.getElementById('operationName').value.trim();
    const description = document.getElementById('operationDescription').value.trim();
    const targetName = document.getElementById('operationTarget').value;
    const keyName = document.getElementById('operationKey').value;
    const operationType = document.getElementById('operationType').value;
    const value = parseFloat(document.getElementById('operationValue').value);
    const startTime = document.getElementById('operationStartTime').value;
    const endTime = document.getElementById('operationEndTime').value;
    
    // 验证必填字段
    if (!name || !targetName || !keyName || isNaN(value)) {
        showError('请填写所有必填字段');
        return;
    }
    
    const operationData = {
        name,
        description: description || null,
        target_name: targetName,
        key_name: keyName,
        operation_type: operationType,
        value,
        start_time: startTime ? new Date(startTime).toISOString() : null,
        end_time: endTime ? new Date(endTime).toISOString() : null
    };
    
    try {
        let response;
        if (editingOperationId) {
            // 更新操作
            operationData.id = editingOperationId;
            operationData.is_active = true; // 默认激活
            response = await fetch(`/api/operations/${editingOperationId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(operationData)
            });
        } else {
            // 创建新操作
            response = await fetch('/api/operations', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(operationData)
            });
        }
        
        // 先检查响应是否正常
        if (!response.ok) {
            const text = await response.text();
            console.error('响应错误:', response.status, text);
            showError(`保存失败: HTTP ${response.status}`);
            return;
        }
        
        // 获取响应文本
        const responseText = await response.text();
        console.log('服务器响应:', responseText);
        
        // 尝试解析JSON
        let result;
        try {
            result = JSON.parse(responseText);
        } catch (jsonError) {
            console.error('JSON解析失败:', responseText);
            showError('保存失败: 服务器返回了无效的JSON格式');
            return;
        }
        
        if (result.success) {
            showSuccess(editingOperationId ? '操作更新成功' : '操作创建成功');
            hideOperationForm();
            refreshOperationsList();
        } else {
            showError('保存失败: ' + result.error);
        }
    } catch (error) {
        console.error('保存操作失败:', error);
        showError('保存失败: ' + error.message);
    }
}

async function editOperation(id) {
    const operation = dataOperations.find(op => op.id === id);
    if (!operation) return;
    
    editingOperationId = id;
    document.getElementById('operationFormTitle').textContent = '编辑数据操作';
    document.getElementById('operationId').value = id;
    document.getElementById('operationName').value = operation.name;
    document.getElementById('operationDescription').value = operation.description || '';
    document.getElementById('operationType').value = operation.operation_type;
    document.getElementById('operationValue').value = operation.value;
    
    // 填充选择器
    populateOperationSelects();
    
    // 设置选中的值
    document.getElementById('operationTarget').value = operation.target_name;
    document.getElementById('operationKey').value = operation.key_name;
    
    // 设置时间（后端已经返回上海时间，直接使用）
    if (operation.start_time) {
        // 后端返回的是 "2025-08-11T10:00:00+08:00" 格式
        // 直接解析并格式化为datetime-local需要的格式
        const startDate = new Date(operation.start_time);
        // 获取年月日时分，格式化为 YYYY-MM-DDTHH:mm
        const year = startDate.getFullYear();
        const month = String(startDate.getMonth() + 1).padStart(2, '0');
        const day = String(startDate.getDate()).padStart(2, '0');
        const hours = String(startDate.getHours()).padStart(2, '0');
        const minutes = String(startDate.getMinutes()).padStart(2, '0');
        document.getElementById('operationStartTime').value = `${year}-${month}-${day}T${hours}:${minutes}`;
    } else {
        document.getElementById('operationStartTime').value = '';
    }
    
    if (operation.end_time) {
        const endDate = new Date(operation.end_time);
        const year = endDate.getFullYear();
        const month = String(endDate.getMonth() + 1).padStart(2, '0');
        const day = String(endDate.getDate()).padStart(2, '0');
        const hours = String(endDate.getHours()).padStart(2, '0');
        const minutes = String(endDate.getMinutes()).padStart(2, '0');
        document.getElementById('operationEndTime').value = `${year}-${month}-${day}T${hours}:${minutes}`;
    } else {
        document.getElementById('operationEndTime').value = '';
    }
    
    document.getElementById('operationForm').style.display = 'block';
}

async function deleteOperation(id) {
    if (!confirm('确定要删除这个操作吗？')) {
        return;
    }
    
    try {
        const response = await fetch(`/api/operations/${id}`, {
            method: 'DELETE'
        });
        
        const result = await response.json();
        
        if (result.success) {
            showSuccess('操作删除成功');
            refreshOperationsList();
        } else {
            showError('删除失败: ' + result.error);
        }
    } catch (error) {
        showError('删除失败: ' + error.message);
    }
}

async function toggleOperation(id) {
    try {
        const response = await fetch(`/api/operations/${id}/toggle`, {
            method: 'POST'
        });
        
        const result = await response.json();
        
        if (result.success) {
            showSuccess('操作状态已更新');
            refreshOperationsList();
        } else {
            showError('更新失败: ' + result.error);
        }
    } catch (error) {
        showError('更新失败: ' + error.message);
    }
}

function showSuccess(message) {
    // 可以实现一个简单的成功提示
    console.log('Success:', message);
    alert(message);
}

function showError(message) {
    console.error('Error:', message);
    alert('错误: ' + message);
}

// 导出操作记录
async function exportOperations() {
    try {
        const response = await fetch('/api/operations/export');
        const result = await response.json();
        
        if (!result.success) {
            showError('导出失败: ' + result.error);
            return;
        }
        
        const exportData = result.data;
        
        if (exportData.length === 0) {
            showError('没有可导出的操作记录');
            return;
        }
        
        // 为每个标靶创建一个JSON文件
        exportData.forEach(data => {
            const filename = `operations_${data.target_name}_${new Date().toISOString().split('T')[0]}.json`;
            const jsonStr = JSON.stringify(data, null, 2);
            const blob = new Blob([jsonStr], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        });
        
        showSuccess(`成功导出 ${exportData.length} 个标靶的操作记录`);
    } catch (error) {
        showError('导出失败: ' + error.message);
    }
}

// 显示导入对话框
function showImportDialog() {
    document.getElementById('importFile').click();
}

// 处理导入文件
async function handleImportFile(event) {
    const files = event.target.files;
    if (files.length === 0) return;
    
    const importData = [];
    
    try {
        // 读取所有文件
        for (let file of files) {
            const text = await file.text();
            const data = JSON.parse(text);
            
            // 转换为导入格式
            if (data.target_name && data.operations) {
                importData.push({
                    target_name: data.target_name,
                    operations: data.operations.map(op => ({
                        name: op.name,
                        description: op.description,
                        key_name: op.key_name,
                        operation_type: op.operation_type,
                        value: op.value,
                        start_time: op.start_time,
                        end_time: op.end_time,
                        is_active: op.is_active !== undefined ? op.is_active : true
                    }))
                });
            }
        }
        
        if (importData.length === 0) {
            showError('没有有效的导入数据');
            return;
        }
        
        // 发送导入请求
        const response = await fetch('/api/operations/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(importData)
        });
        
        const result = await response.json();
        
        if (result.success) {
            showSuccess(`成功导入 ${result.data.length} 个操作记录`);
            refreshOperationsList();
        } else {
            showError('导入失败: ' + result.error);
        }
    } catch (error) {
        showError('导入失败: ' + error.message);
    }
    
    // 清空文件选择
    event.target.value = '';
}

// 文件结束
