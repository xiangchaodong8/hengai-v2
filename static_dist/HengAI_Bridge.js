// 👑 HengAI Bridge V4.0 - 全域数据灌注总线
window.addEventListener('message', function(e) {
    if (e.data.type === 'HENGAI_HUB_PIPELINE') {
        const state = e.data.payload;
        // 1. 自动寻找所有带绑定属性的元素
        document.querySelectorAll('[data-state-bind]').forEach(el => {
            const path = el.getAttribute('data-state-bind');
            const value = path.split('.').reduce((o, i) => (o ? o[i] : null), state);
            // 2. 智能处理：如果是0或有值则显示，如果是null则显示默认占位
            el.textContent = (value !== null && value !== undefined) ? value : (el.getAttribute('data-empty') || '---');
        });
        // 3. 自动触发页面内的重绘函数 (如果有)
        if (typeof window.onStateSync === 'function') window.onStateSync(state);
    }
});
// 页面加载后主动向父窗口要一次数据
window.parent.postMessage({ type: 'REQUEST_SYNC' }, '*');