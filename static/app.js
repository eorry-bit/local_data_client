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
        showSuccess('每日时间段过滤已启用，点击"配置时间段"设置具体时间');
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
        showSuccess('数据聚合模式已启用：限制1万数据点，1小时时间窗口平均值聚合');
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
            title: '数值'
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

// 更新图表
function updateChart() {
    if (currentData.length === 0) {
        showError('没有找到符合条件的数据');
        return;
    }
    
    // 按标靶分组数据
    const groupedData = {};
    currentData.forEach(item => {
        if (!groupedData[item.target_name]) {
            groupedData[item.target_name] = {
                x: [],
                y: [],
                name: item.target_name,
                type: 'scatter',
                mode: 'lines+markers',
                line: { width: 2 },
                marker: { size: 4 },
                hovertemplate: '<b>%{fullData.name}</b><br>' +
                              '时间: %{x|%Y/%m/%d %H:%M:%S}<br>' +
                              '数值: %{y}<br>' +
                              '<extra></extra>'
            };
        }
        groupedData[item.target_name].x.push(new Date(item.timestamp));
        groupedData[item.target_name].y.push(item.value);
    });
    
    const traces = Object.values(groupedData);
    
    const layout = {
        title: {
            text: `${currentData[0].asset_name} - ${currentData[0].device_name} - ${currentData[0].key_name}`,
            font: { size: 18 }
        },
        xaxis: {
            title: '时间',
            type: 'date',
            tickformat: '%Y/%m/%d %H:%M:%S',
            hoverformat: '%Y/%m/%d %H:%M:%S'
        },
        yaxis: {
            title: '数值'
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
            '数值': item.value
        }));

        // 创建数据透视表
        const pivotData = createPivotTable(currentData);

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

        // 数据透视表工作表
        const ws2 = XLSX.utils.json_to_sheet(pivotData);
        const colWidths2 = [
            { wch: 15 }, // 标靶名称
            { wch: 12 }, // 数据点数
            { wch: 12 }, // 平均值
            { wch: 12 }, // 最大值
            { wch: 12 }, // 最小值
            { wch: 12 }, // 标准差
            { wch: 20 }, // 最早时间
            { wch: 20 }  // 最晚时间
        ];
        ws2['!cols'] = colWidths2;
        XLSX.utils.book_append_sheet(wb, ws2, '数据透视表');

        // 统计汇总工作表
        const ws3 = XLSX.utils.json_to_sheet(summaryData);
        const colWidths3 = [
            { wch: 20 }, // 统计项
            { wch: 15 }  // 值
        ];
        ws3['!cols'] = colWidths3;
        XLSX.utils.book_append_sheet(wb, ws3, '统计汇总');

        // 生成文件名
        const now = new Date();
        const fileName = `遥测数据分析_${formatDateForFilename(now)}.xlsx`;

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

// 创建数据透视表
function createPivotTable(data) {
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
        { '统计项': '数值平均值', '值': avg.toFixed(3) },
        { '统计项': '数值最大值', '值': max },
        { '统计项': '数值最小值', '值': min },
        { '统计项': '数值范围', '值': (max - min).toFixed(3) }
    ];
}

// 更新导出按钮状态
function updateExportButton() {
    const exportBtn = document.getElementById('exportBtn');
    exportBtn.disabled = currentData.length === 0;
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
