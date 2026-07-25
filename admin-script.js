// Admin Panel JavaScript
class AdminPanel {
    constructor() {
        this.token = null;
        this.refreshInterval = null;
        this.autoRefresh = true;
        this.initialize();
    }
    
    initialize() {
        // Elements
        this.loginScreen = document.getElementById('loginScreen');
        this.adminDashboard = document.getElementById('adminDashboard');
        this.adminIdInput = document.getElementById('adminId');
        this.adminPasswordInput = document.getElementById('adminPassword');
        this.adminLoginBtn = document.getElementById('adminLoginBtn');
        this.logoutBtn = document.getElementById('logoutBtn');
        this.refreshBtn = document.getElementById('refreshBtn');
        
        // Check for saved token
        this.token = localStorage.getItem('adminToken');
        if (this.token) {
            this.verifyToken();
        }
        
        // Event Listeners
        this.setupEventListeners();
        
        // Update server time
        this.updateServerTime();
        setInterval(() => this.updateServerTime(), 1000);
    }
    
    setupEventListeners() {
        // Login
        this.adminLoginBtn.addEventListener('click', () => this.login());
        this.adminIdInput.addEventListener('keypress', (e) => e.key === 'Enter' && this.login());
        this.adminPasswordInput.addEventListener('keypress', (e) => e.key === 'Enter' && this.login());
        
        // Logout
        this.logoutBtn.addEventListener('click', () => this.logout());
        
        // Refresh
        this.refreshBtn.addEventListener('click', () => this.refreshData());
        
        // Block actions
        document.getElementById('blockBtn').addEventListener('click', () => this.blockDevice());
        document.getElementById('quickBlockBtn').addEventListener('click', () => this.quickBlock());
        
        // View all reports
        document.getElementById('viewAllReports').addEventListener('click', () => this.viewAllReports());
        
        // Disconnect all
        document.getElementById('disconnectAllBtn').addEventListener('click', () => this.disconnectAll());
        
        // Action buttons
        document.getElementById('maintenanceBtn').addEventListener('click', () => this.toggleMaintenance());
        document.getElementById('cleanupBtn').addEventListener('click', () => this.cleanupDatabase());
        document.getElementById('backupBtn').addEventListener('click', () => this.backupData());
        document.getElementById('logsBtn').addEventListener('click', () => this.viewLogs());
        document.getElementById('settingsBtn').addEventListener('click', () => this.openSettings());
        document.getElementById('helpBtn').addEventListener('click', () => this.showHelp());
        
        // Footer links
        document.getElementById('goToChat').addEventListener('click', (e) => {
            e.preventDefault();
            window.open('/', '_blank');
        });
    }
    
    async login() {
        const username = this.adminIdInput.value.trim();
        const password = this.adminPasswordInput.value;
        
        if (!username || !password) {
            this.showNotification('Please enter credentials', 'error');
            return;
        }
        
        try {
            const response = await fetch('/admin/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            
            const data = await response.json();
            
            if (data.success) {
                this.token = data.token;
                localStorage.setItem('adminToken', this.token);
                
                this.loginScreen.classList.remove('active');
                this.adminDashboard.classList.add('active');
                
                this.showNotification('Login successful! Welcome to Admin Panel', 'success');
                
                // Clear password field
                this.adminPasswordInput.value = '';
                
                // Start auto-refresh
                this.startAutoRefresh();
                
            } else {
                this.showNotification(data.message, 'error');
                this.adminPasswordInput.value = '';
                this.adminPasswordInput.focus();
            }
            
        } catch (error) {
            console.error('Login error:', error);
            this.showNotification('Connection error. Please check server.', 'error');
        }
    }
    
    async verifyToken() {
        try {
            const response = await fetch('/admin/data', {
                headers: { 'Authorization': `Basic ${this.token}` }
            });
            
            if (response.ok) {
                this.loginScreen.classList.remove('active');
                this.adminDashboard.classList.add('active');
                this.loadDashboardData();
                this.startAutoRefresh();
            } else {
                localStorage.removeItem('adminToken');
                this.token = null;
            }
        } catch (error) {
            localStorage.removeItem('adminToken');
            this.token = null;
        }
    }
    
    logout() {
        if (confirm('Are you sure you want to logout?')) {
            this.token = null;
            localStorage.removeItem('adminToken');
            
            this.adminDashboard.classList.remove('active');
            this.loginScreen.classList.add('active');
            
            this.stopAutoRefresh();
            this.showNotification('Logged out successfully', 'info');
        }
    }
    
    startAutoRefresh() {
        this.stopAutoRefresh();
        if (this.autoRefresh) {
            this.refreshInterval = setInterval(() => {
                this.loadDashboardData();
            }, 10000); // Refresh every 10 seconds
        }
    }
    
    stopAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
    }
    
    async refreshData() {
        this.showNotification('Refreshing data...', 'info');
        await this.loadDashboardData();
        this.showNotification('Data refreshed successfully', 'success');
    }
    
    async loadDashboardData() {
        if (!this.token) return;
        
        try {
            const response = await fetch('/admin/data', {
                headers: { 'Authorization': `Basic ${this.token}` }
            });
            
            if (response.status === 401) {
                this.logout();
                return;
            }
            
            const data = await response.json();
            
            if (data.success) {
                this.updateDashboard(data);
            }
            
        } catch (error) {
            console.error('Error loading dashboard data:', error);
            this.showNotification('Error loading data', 'error');
        }
    }
    
    updateDashboard(data) {
        // Update main stats
        document.getElementById('totalUsers').textContent = data.totalUsers || 0;
        document.getElementById('onlineUsers').textContent = data.onlineUsers || 0;
        document.getElementById('totalReports').textContent = data.totalReports || 0;
        document.getElementById('blockedUsers').textContent = data.blockedUsers || 0;
        
        // Update reports table
        this.updateReportsTable(data.reports || []);
        
        // Update blocked devices table
        this.updateBlockedTable(data.blocked || []);
        
        // Update online users list
        this.updateOnlineList(data.online || []);
        
        // Update system info
        document.getElementById('dbSize').textContent = data.dbSize || '0 MB';
        document.getElementById('lastUpdate').textContent = new Date().toLocaleTimeString();
        
        // Calculate active calls
        const activeCalls = Math.floor((data.online || []).length / 2);
        document.getElementById('activeCalls').textContent = activeCalls;
        
        // Update waiting users (simulated)
        document.getElementById('waitingUsers').textContent = Math.max(0, (data.online || []).length - activeCalls * 2);
        
        // Update connections
        document.getElementById('connectionCount').textContent = data.onlineUsers || 0;
        this.updateConnectionsList(data.online || []);
        
        // Update activity log
        this.updateActivityLog(data.reports || []);
        
        // Update system stats (simulated)
        this.updateSystemStats();
    }
    
    updateReportsTable(reports) {
        const tbody = document.querySelector('#reportsTable tbody');
        tbody.innerHTML = '';
        
        if (reports.length === 0) {
            tbody.innerHTML = `
                <tr class="no-data-row">
                    <td colspan="7">No reports available</td>
                </tr>
            `;
            return;
        }
        
        // Show only latest 5 reports
        const recentReports = reports.slice(0, 5);
        
        recentReports.forEach(report => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${report.id}</td>
                <td><code title="${report.reported_ip}">${report.reported_ip.substring(0, 15)}...</code></td>
                <td><code title="${report.reporter_ip}">${report.reporter_ip.substring(0, 15)}...</code></td>
                <td>
                    <span class="badge badge-${this.getReportBadgeClass(report.reason)}">
                        ${this.formatReason(report.reason)}
                    </span>
                </td>
                <td>
                    <span class="badge badge-${report.status === 'pending' ? 'warning' : 'success'}">
                        ${report.status}
                    </span>
                </td>
                <td>${new Date(report.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</td>
                <td>
                    <div class="btn-group">
                        <button class="btn-sm btn-danger-sm" onclick="admin.blockReported('${report.reported_ip}', '${report.reason}')">
                            <i class="fas fa-ban"></i>
                        </button>
                        <button class="btn-sm btn-secondary" onclick="admin.dismissReport(${report.id})">
                            <i class="fas fa-check"></i>
                        </button>
                        <button class="btn-sm btn-info" onclick="admin.viewReportDetails(${report.id})">
                            <i class="fas fa-eye"></i>
                        </button>
                    </div>
                </td>
            `;
            tbody.appendChild(row);
        });
    }
    
    updateBlockedTable(blocked) {
        const tbody = document.querySelector('#blockedTable tbody');
        tbody.innerHTML = '';
        
        if (blocked.length === 0) {
            tbody.innerHTML = `
                <tr class="no-data-row">
                    <td colspan="5">No blocked devices</td>
                </tr>
            `;
            return;
        }
        
        blocked.forEach(block => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td><code>${block.ip_address}</code></td>
                <td><code>${block.device_id || 'N/A'}</code></td>
                <td>${block.reason || 'Manual block'}</td>
                <td>${new Date(block.blocked_at).toLocaleDateString()}</td>
                <td>
                    <button class="btn-sm btn-success" onclick="admin.unblockDevice('${block.ip_address}')">
                        <i class="fas fa-unlock"></i> Unblock
                    </button>
                </td>
            `;
            tbody.appendChild(row);
        });
    }
    
    updateOnlineList(onlineUsers) {
        const onlineList = document.getElementById('onlineList');
        onlineList.innerHTML = '';
        
        if (onlineUsers.length === 0) {
            onlineList.innerHTML = `
                <div class="no-online-users">
                    <i class="fas fa-users-slash"></i>
                    <p>No users online</p>
                </div>
            `;
            return;
        }
        
        onlineUsers.forEach(user => {
            const userElement = document.createElement('div');
            userElement.className = 'online-user';
            userElement.innerHTML = `
                <div class="user-info">
                    <div class="user-avatar">
                        <i class="fas fa-user-secret"></i>
                    </div>
                    <div class="user-details">
                        <div class="username">
                            <strong>${user.username || 'Anonymous'}</strong>
                            <span class="user-status"></span>
                        </div>
                        <div class="user-meta">
                            <span><i class="fas fa-globe"></i> ${user.ip_address}</span>
                            <span><i class="far fa-clock"></i> ${new Date(user.joined_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                        </div>
                    </div>
                </div>
                <div class="user-actions">
                    <button class="btn-sm btn-danger-sm" onclick="admin.blockUser('${user.ip_address}', '${user.username}')">
                        <i class="fas fa-ban"></i> Block
                    </button>
                    <button class="btn-sm btn-info" onclick="admin.viewUserDetails('${user.ip_address}')">
                        <i class="fas fa-info-circle"></i>
                    </button>
                </div>
            `;
            onlineList.appendChild(userElement);
        });
    }
    
    updateConnectionsList(onlineUsers) {
        const connectionsList = document.getElementById('connectionsList');
        connectionsList.innerHTML = '';
        
        if (onlineUsers.length === 0) {
            connectionsList.innerHTML = `
                <div class="no-connections">
                    <i class="fas fa-wifi-slash"></i>
                    <p>No active connections</p>
                </div>
            `;
            return;
        }
        
        // Group users by pairs (simulated)
        const connections = [];
        for (let i = 0; i < onlineUsers.length; i += 2) {
            const user1 = onlineUsers[i];
            const user2 = onlineUsers[i + 1];
            
            connections.push({
                user1: user1,
                user2: user2,
                connectedAt: new Date(user1.joined_at).getTime()
            });
        }
        
        connections.forEach((conn, index) => {
            const connectionElement = document.createElement('div');
            connectionElement.className = 'connection-item';
            connectionElement.innerHTML = `
                <div class="connection-header">
                    <div class="connection-user">
                        <strong>Connection #${index + 1}</strong>
                        <span class="connection-ip">${conn.user1.ip_address} ↔ ${conn.user2?.ip_address || 'Searching...'}</span>
                    </div>
                    <div class="connection-status">
                        <i class="fas fa-plug"></i>
                        ${conn.user2 ? 'Connected' : 'Waiting'}
                    </div>
                </div>
                <div class="connection-details">
                    <p><i class="fas fa-user"></i> ${conn.user1.username} ${conn.user2 ? '↔ ' + conn.user2.username : ' (searching for partner...)'}</p>
                    <p><i class="far fa-clock"></i> Duration: ${this.formatDuration(Date.now() - conn.connectedAt)}</p>
                </div>
            `;
            connectionsList.appendChild(connectionElement);
        });
    }
    
    updateActivityLog(reports) {
        const activityLog = document.getElementById('activityLog');
        activityLog.innerHTML = '';
        
        if (reports.length === 0) {
            activityLog.innerHTML = `
                <div class="no-activity">
                    <i class="fas fa-history"></i>
                    <p>No recent activity</p>
                </div>
            `;
            return;
        }
        
        // Create activity items from reports
        reports.slice(0, 5).forEach(report => {
            const activityItem = document.createElement('div');
            activityItem.className = 'activity-item';
            activityItem.innerHTML = `
                <div class="activity-icon report">
                    <i class="fas fa-flag"></i>
                </div>
                <div class="activity-content">
                    <div class="activity-text">
                        User reported for ${this.formatReason(report.reason)}
                    </div>
                    <div class="activity-time">
                        ${new Date(report.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                    </div>
                </div>
            `;
            activityLog.appendChild(activityItem);
        });
    }
    
    updateSystemStats() {
        // Simulated system stats
        document.getElementById('cpuUsage').textContent = `${Math.floor(Math.random() * 30) + 10}%`;
        document.getElementById('memoryUsage').textContent = `${Math.floor(Math.random() * 40) + 20}%`;
        document.getElementById('activeConnections').textContent = Math.floor(Math.random() * 50) + 10;
        document.getElementById('serverUptime').textContent = this.formatDuration(Math.floor(Math.random() * 86400000) + 3600000);
    }
    
    updateServerTime() {
        const timeElement = document.querySelector('#serverTime span');
        if (timeElement) {
            const now = new Date();
            timeElement.textContent = now.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'});
        }
    }
    
    async blockDevice() {
        const ip = document.getElementById('blockIP').value.trim();
        const reason = document.getElementById('blockReason').value.trim();
        const deviceId = document.getElementById('blockDeviceId').value.trim();
        
        if (!ip) {
            this.showNotification('Please enter IP address', 'warning');
            return;
        }
        
        if (!confirm(`Block device with IP: ${ip}? This will prevent them from accessing the chat.`)) {
            return;
        }
        
        try {
            const response = await fetch('/admin/block', {
                method: 'POST',
                headers: {
                    'Authorization': `Basic ${this.token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    ip: ip,
                    deviceId: deviceId || null,
                    reason: reason || 'Blocked by admin'
                })
            });
            
            const data = await response.json();
            
            if (data.success) {
                this.showNotification(`Device ${ip} blocked successfully`, 'success');
                
                // Clear form
                document.getElementById('blockIP').value = '';
                document.getElementById('blockReason').value = '';
                document.getElementById('blockDeviceId').value = '';
                
                // Refresh data
                this.refreshData();
            } else {
                this.showNotification(data.message, 'error');
            }
            
        } catch (error) {
            console.error('Error blocking device:', error);
            this.showNotification('Error blocking device', 'error');
        }
    }
    
    async quickBlock() {
        const ip = document.getElementById('quickBlockIP').value.trim();
        
        if (!ip) {
            this.showNotification('Please enter IP address', 'warning');
            return;
        }
        
        if (!confirm(`Quick block IP: ${ip}?`)) {
            return;
        }
        
        try {
            const response = await fetch('/admin/block', {
                method: 'POST',
                headers: {
                    'Authorization': `Basic ${this.token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    ip: ip,
                    reason: 'Quick blocked from admin panel'
                })
            });
            
            const data = await response.json();
            
            if (data.success) {
                this.showNotification(`IP ${ip} blocked successfully`, 'success');
                document.getElementById('quickBlockIP').value = '';
                this.refreshData();
            }
            
        } catch (error) {
            console.error('Error quick blocking:', error);
            this.showNotification('Error blocking IP', 'error');
        }
    }
    
    async blockReported(ip, reason) {
        if (!confirm(`Block reported IP: ${ip}?`)) {
            return;
        }
        
        try {
            const response = await fetch('/admin/block', {
                method: 'POST',
                headers: {
                    'Authorization': `Basic ${this.token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    ip: ip,
                    reason: `Reported: ${reason}`
                })
            });
            
            const data = await response.json();
            
            if (data.success) {
                this.showNotification(`Reported user blocked successfully`, 'success');
                this.refreshData();
            }
            
        } catch (error) {
            console.error('Error blocking reported user:', error);
            this.showNotification('Error blocking user', 'error');
        }
    }
    
    async blockUser(ip, username) {
        if (!confirm(`Block user "${username}" (IP: ${ip})?`)) {
            return;
        }
        
        try {
            const response = await fetch('/admin/block', {
                method: 'POST',
                headers: {
                    'Authorization': `Basic ${this.token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    ip: ip,
                    reason: 'Blocked from online list'
                })
            });
            
            const data = await response.json();
            
            if (data.success) {
                this.showNotification(`User ${username} blocked successfully`, 'success');
                this.refreshData();
            }
            
        } catch (error) {
            console.error('Error blocking user:', error);
            this.showNotification('Error blocking user', 'error');
        }
    }
    
    async dismissReport(id) {
        if (!confirm('Dismiss this report?')) {
            return;
        }
        
        try {
            const response = await fetch('/admin/update-report', {
                method: 'POST',
                headers: {
                    'Authorization': `Basic ${this.token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ 
                    id: id, 
                    status: 'dismissed' 
                })
            });
            
            const data = await response.json();
            
            if (data.success) {
                this.showNotification('Report dismissed', 'info');
                this.refreshData();
            }
            
        } catch (error) {
            console.error('Error dismissing report:', error);
            this.showNotification('Error dismissing report', 'error');
        }
    }
    
    async unblockDevice(ip) {
        if (!confirm(`Unblock IP: ${ip}?`)) {
            return;
        }
        
        try {
            const response = await fetch('/admin/unblock', {
                method: 'POST',
                headers: {
                    'Authorization': `Basic ${this.token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ ip: ip })
            });
            
            const data = await response.json();
            
            if (data.success) {
                this.showNotification(`IP ${ip} unblocked`, 'success');
                this.refreshData();
            }
            
        } catch (error) {
            console.error('Error unblocking device:', error);
            this.showNotification('Error unblocking device', 'error');
        }
    }
    
    async disconnectAll() {
        if (!confirm('Disconnect all active users? This will temporarily interrupt all chats.')) {
            return;
        }
        
        try {
            const response = await fetch('/admin/disconnect-all', {
                method: 'POST',
                headers: { 'Authorization': `Basic ${this.token}` }
            });
            
            if (response.ok) {
                this.showNotification('All users disconnected', 'success');
                this.refreshData();
            }
            
        } catch (error) {
            console.error('Error disconnecting users:', error);
            this.showNotification('Error disconnecting users', 'error');
        }
    }
    
    async toggleMaintenance() {
        const maintenance = confirm('Toggle maintenance mode? Users will see a maintenance message.');
        
        if (maintenance) {
            try {
                const response = await fetch('/admin/maintenance', {
                    method: 'POST',
                    headers: { 'Authorization': `Basic ${this.token}` },
                    body: JSON.stringify({ enabled: true })
                });
                
                if (response.ok) {
                    this.showNotification('Maintenance mode enabled', 'warning');
                }
            } catch (error) {
                console.error('Error toggling maintenance:', error);
            }
        }
    }
    
    async cleanupDatabase() {
        if (!confirm('Cleanup old database entries? This will remove data older than 7 days.')) {
            return;
        }
        
        try {
            const response = await fetch('/admin/cleanup', {
                method: 'POST',
                headers: { 'Authorization': `Basic ${this.token}` }
            });
            
            if (response.ok) {
                this.showNotification('Database cleanup completed', 'success');
                this.refreshData();
            }
        } catch (error) {
            console.error('Error cleaning database:', error);
            this.showNotification('Error cleaning database', 'error');
        }
    }
    
    async backupData() {
        this.showNotification('Creating backup...', 'info');
        
        try {
            const response = await fetch('/admin/backup', {
                headers: { 'Authorization': `Basic ${this.token}` }
            });
            
            if (response.ok) {
                const blob = await response.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `backup-${new Date().toISOString().split('T')[0]}.db`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                window.URL.revokeObjectURL(url);
                
                this.showNotification('Backup downloaded successfully', 'success');
            }
        } catch (error) {
            console.error('Error creating backup:', error);
            this.showNotification('Error creating backup', 'error');
        }
    }
    
    viewLogs() {
        this.showNotification('Logs feature coming soon', 'info');
    }
    
    openSettings() {
        this.showNotification('Settings feature coming soon', 'info');
    }
    
    showHelp() {
        const helpHtml = `
            <h3>Admin Panel Help</h3>
            <div class="help-content">
                <p><strong>Dashboard Overview:</strong></p>
                <ul>
                    <li>Monitor real-time user activity</li>
                    <li>View and manage user reports</li>
                    <li>Block/unblock devices by IP</li>
                    <li>View system statistics</li>
                </ul>
                <p><strong>Quick Actions:</strong></p>
                <ul>
                    <li><strong>Refresh:</strong> Update all data</li>
                    <li><strong>Block:</strong> Enter IP and reason to block</li>
                    <li><strong>Reports:</strong> Review and act on user reports</li>
                </ul>
            </div>
        `;
        
        alert(helpHtml);
    }
    
    viewAllReports() {
        this.showNotification('Loading all reports...', 'info');
        // In a real implementation, this would open a modal with all reports
    }
    
    viewReportDetails(id) {
        this.showNotification(`Viewing report #${id} details`, 'info');
        // In a real implementation, this would open a modal with report details
    }
    
    viewUserDetails(ip) {
        this.showNotification(`Viewing user details for ${ip}`, 'info');
        // In a real implementation, this would open a modal with user details
    }
    
    // Helper methods
    getReportBadgeClass(reason) {
        const classes = {
            'inappropriate_content': 'danger',
            'harassment': 'warning',
            'spam': 'info',
            'underage': 'danger',
            'explicit_content': 'danger',
            'other': 'secondary'
        };
        return classes[reason] || 'secondary';
    }
    
    formatReason(reason) {
        const reasons = {
            'inappropriate_content': 'Inappropriate Content',
            'harassment': 'Harassment',
            'spam': 'Spam',
            'underage': 'Underage User',
            'explicit_content': 'Explicit Content',
            'other': 'Other'
        };
        return reasons[reason] || reason;
    }
    
    formatDuration(ms) {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);
        
        if (days > 0) return `${days}d ${hours % 24}h`;
        if (hours > 0) return `${hours}h ${minutes % 60}m`;
        if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
        return `${seconds}s`;
    }
    
    showNotification(message, type = 'info') {
        const container = document.getElementById('adminNotifications');
        const notification = document.createElement('div');
        notification.className = `admin-notification ${type}`;
        
        const icons = {
            success: 'check-circle',
            error: 'exclamation-circle',
            warning: 'exclamation-triangle',
            info: 'info-circle'
        };
        
        notification.innerHTML = `
            <div class="notification-icon">
                <i class="fas fa-${icons[type] || 'info-circle'}"></i>
            </div>
            <div class="notification-content">
                <div class="notification-title">${type.charAt(0).toUpperCase() + type.slice(1)}</div>
                <div class="notification-message">${message}</div>
            </div>
            <button class="notification-close" onclick="this.parentElement.remove()">
                <i class="fas fa-times"></i>
            </button>
        `;
        
        container.appendChild(notification);
        
        // Auto remove after 5 seconds
        setTimeout(() => {
            if (notification.parentElement) {
                notification.style.opacity = '0';
                notification.style.transform = 'translateX(100%)';
                setTimeout(() => {
                    if (notification.parentElement) {
                        notification.parentElement.removeChild(notification);
                    }
                }, 300);
            }
        }, 5000);
    }
}

// Initialize admin panel
let admin;
document.addEventListener('DOMContentLoaded', () => {
    admin = new AdminPanel();
});

// Make admin methods globally available for onclick handlers
window.admin = {
    blockReported: (ip, reason) => admin.blockReported(ip, reason),
    dismissReport: (id) => admin.dismissReport(id),
    blockUser: (ip, username) => admin.blockUser(ip, username),
    unblockDevice: (ip) => admin.unblockDevice(ip),
    viewReportDetails: (id) => admin.viewReportDetails(id),
    viewUserDetails: (ip) => admin.viewUserDetails(ip)
};