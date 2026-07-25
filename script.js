// Client-side JavaScript for Anonymous Video Chat
class VideoChat {
    constructor() {
        this.socket = null;
        this.peerConnection = null;
        this.localStream = null;
        this.remoteStream = null;
        this.username = '';
        this.currentPartner = null;
        this.dataChannel = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        
        // Better WebRTC configuration
        this.configuration = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' },
                { urls: 'stun:stun3.l.google.com:19302' },
                { urls: 'stun:stun4.l.google.com:19302' }
            ],
            iceCandidatePoolSize: 10,
            bundlePolicy: 'max-bundle',
            rtcpMuxPolicy: 'require'
        };
        
        this.initialize();
    }
    
    initialize() {
        // DOM Elements
        this.joinScreen = document.getElementById('joinScreen');
        this.chatScreen = document.getElementById('chatScreen');
        this.usernameInput = document.getElementById('username');
        this.joinBtn = document.getElementById('joinBtn');
        this.nextBtn = document.getElementById('nextBtn');
        this.reportBtn = document.getElementById('reportBtn');
        this.endCallBtn = document.getElementById('endCall');
        this.toggleVideoBtn = document.getElementById('toggleVideo');
        this.toggleAudioBtn = document.getElementById('toggleAudio');
        this.messageInput = document.getElementById('messageInput');
        this.sendBtn = document.getElementById('sendBtn');
        this.messagesContainer = document.getElementById('messages');
        this.localVideo = document.getElementById('localVideo');
        this.remoteVideo = document.getElementById('remoteVideo');
        this.partnerName = document.getElementById('partnerName');
        this.remoteLabel = document.getElementById('remoteLabel');
        this.onlineCount = document.getElementById('onlineCount');
        
        // Modal Elements
        this.reportModal = document.getElementById('reportModal');
        this.cancelReport = document.getElementById('cancelReport');
        this.submitReport = document.getElementById('submitReport');
        
        // Event Listeners
        this.joinBtn.addEventListener('click', () => this.joinChat());
        this.nextBtn.addEventListener('click', () => this.nextPerson());
        this.reportBtn.addEventListener('click', () => this.showReportModal());
        this.endCallBtn.addEventListener('click', () => this.endCall());
        this.toggleVideoBtn.addEventListener('click', () => this.toggleVideo());
        this.toggleAudioBtn.addEventListener('click', () => this.toggleAudio());
        this.sendBtn.addEventListener('click', () => this.sendMessage());
        this.messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendMessage();
        });
        
        // Modal events
        this.cancelReport.addEventListener('click', () => this.hideReportModal());
        this.submitReport.addEventListener('click', () => this.submitReport());
        
        // Initialize WebSocket
        this.connectWebSocket();
        
        // Auto-focus username input
        this.usernameInput.focus();
        
        // Handle page visibility
        document.addEventListener('visibilitychange', () => {
            if (document.hidden && this.peerConnection) {
                this.sendStreamStatus(false, false);
            } else if (this.peerConnection) {
                this.sendStreamStatus(true, true);
            }
        });
    }
    
    connectWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.hostname || 'localhost';
        const port = window.location.port || (protocol === 'wss:' ? '443' : '80');
        const wsUrl = `${protocol}//${host}:${port}`;
        
        console.log('Connecting to WebSocket:', wsUrl);
        
        this.socket = new WebSocket(wsUrl);
        
        this.socket.onopen = () => {
            console.log('✅ Connected to signaling server');
            this.reconnectAttempts = 0;
            this.updateOnlineCount();
            this.showNotification('Connected to server', 'success');
        };
        
        this.socket.onmessage = async (event) => {
            try {
                const data = JSON.parse(event.data);
                console.log('📨 Received:', data.type);
                
                await this.handleServerMessage(data);
            } catch (error) {
                console.error('Error parsing message:', error);
            }
        };
        
        this.socket.onclose = (event) => {
            console.log('🔌 Disconnected from signaling server:', event.code, event.reason);
            
            if (event.code !== 1000 && this.reconnectAttempts < this.maxReconnectAttempts) {
                this.reconnectAttempts++;
                const delay = Math.min(3000 * this.reconnectAttempts, 15000);
                
                this.showNotification(`Reconnecting in ${delay/1000} seconds...`, 'warning');
                
                setTimeout(() => {
                    this.connectWebSocket();
                }, delay);
            } else if (this.reconnectAttempts >= this.maxReconnectAttempts) {
                this.showNotification('Connection lost. Please refresh the page.', 'error');
            }
        };
        
        this.socket.onerror = (error) => {
            console.error('❌ WebSocket error:', error);
            this.showNotification('Connection error', 'error');
        };
    }
    
    async handleServerMessage(data) {
        switch (data.type) {
            case 'onlineCount':
                this.onlineCount.textContent = data.count;
                break;
                
            case 'joined':
                this.showNotification(data.message, 'success');
                break;
                
            case 'searching':
                this.showNotification(data.message, 'info');
                break;
                
            case 'matched':
                this.currentPartner = data.partner;
                this.partnerName.textContent = data.partner.username;
                this.remoteLabel.textContent = data.partner.username;
                this.showNotification(data.message, 'success');
                await this.startCall();
                break;
                
            case 'offer':
                await this.handleOffer(data.offer, data.from);
                break;
                
            case 'answer':
                await this.handleAnswer(data.answer);
                break;
                
            case 'iceCandidate':
                await this.handleIceCandidate(data.candidate);
                break;
                
            case 'message':
                this.receiveMessage(data.message, data.from, data.timestamp);
                break;
                
            case 'partnerDisconnected':
                this.showNotification('Partner disconnected. Finding next person...', 'warning');
                this.cleanupCurrentCall();
                this.findNextPartner();
                break;
                
            case 'error':
                this.showNotification(data.message, 'error');
                break;
                
            case 'blocked':
                this.showNotification(data.message, 'error');
                this.socket.close();
                break;
                
            case 'reported':
                this.showNotification(data.message, 'success');
                break;
                
            case 'pong':
                // Keep alive
                break;
        }
    }
    
    updateOnlineCount() {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify({ type: 'getOnlineCount' }));
        }
    }
    
    async joinChat() {
        this.username = this.usernameInput.value.trim();
        
        if (!this.username) {
            this.showNotification('Please enter a display name', 'warning');
            this.usernameInput.focus();
            return;
        }
        
        if (this.username.length > 20) {
            this.showNotification('Name too long (max 20 characters)', 'warning');
            return;
        }
        
        // Send join request
        this.socket.send(JSON.stringify({
            type: 'join',
            username: this.username
        }));
        
        // Get user media
        try {
            const constraints = {
                video: {
                    width: { ideal: 640 },
                    height: { ideal: 480 },
                    frameRate: { ideal: 24 }
                },
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            };
            
            this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
            
            this.localVideo.srcObject = this.localStream;
            
            // Switch to chat screen
            this.joinScreen.classList.remove('active');
            this.chatScreen.classList.add('active');
            
            this.showNotification('Looking for someone to chat with...', 'info');
            
            // Start finding partner
            this.findPartner();
            
        } catch (error) {
            console.error('Error accessing media devices:', error);
            
            if (error.name === 'NotAllowedError') {
                this.showNotification('Camera/microphone permission denied. You can still chat via text.', 'error');
            } else if (error.name === 'NotFoundError') {
                this.showNotification('No camera/microphone found. You can still chat via text.', 'error');
            } else {
                this.showNotification('Cannot access camera/microphone. You can still chat via text.', 'error');
            }
            
            // Still join without media
            this.joinScreen.classList.remove('active');
            this.chatScreen.classList.add('active');
            this.findPartner();
        }
    }
    
    findPartner() {
        if (this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify({
                type: 'findPartner'
            }));
        } else {
            this.showNotification('Not connected to server', 'error');
        }
    }
    
    findNextPartner() {
        this.cleanupCurrentCall();
        setTimeout(() => this.findPartner(), 1000);
    }
    
    nextPerson() {
        this.showNotification('Finding next person...', 'info');
        if (this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify({
                type: 'nextPerson'
            }));
        }
    }
    
    sendStreamStatus(video, audio) {
        if (this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify({
                type: 'streamStatus',
                video: video,
                audio: audio
            }));
        }
    }
    
    async startCall() {
        try {
            // Clean up previous connection if exists
            if (this.peerConnection) {
                this.peerConnection.close();
            }
            
            // Create peer connection with better configuration
            this.peerConnection = new RTCPeerConnection(this.configuration);
            
            // Add local stream to connection
            if (this.localStream) {
                this.localStream.getTracks().forEach(track => {
                    this.peerConnection.addTrack(track, this.localStream);
                });
            }
            
            // Handle remote stream
            this.peerConnection.ontrack = (event) => {
                console.log('Received remote track:', event.track.kind);
                
                if (!this.remoteStream) {
                    this.remoteStream = new MediaStream();
                }
                
                // Remove existing tracks of same type
                const existingTracks = this.remoteStream.getTracks();
                existingTracks.forEach(track => {
                    if (track.kind === event.track.kind) {
                        this.remoteStream.removeTrack(track);
                    }
                });
                
                // Add new track
                this.remoteStream.addTrack(event.track);
                this.remoteVideo.srcObject = this.remoteStream;
                
                // Handle track ended
                event.track.onended = () => {
                    console.log(`${event.track.kind} track ended`);
                };
            };
            
            // Handle ICE candidates
            this.peerConnection.onicecandidate = (event) => {
                if (event.candidate && this.socket && this.currentPartner) {
                    console.log('Sending ICE candidate');
                    this.socket.send(JSON.stringify({
                        type: 'iceCandidate',
                        candidate: event.candidate,
                        to: this.currentPartner.id
                    }));
                }
            };
            
            // Handle connection state
            this.peerConnection.onconnectionstatechange = () => {
                console.log('Connection state:', this.peerConnection.connectionState);
                
                switch (this.peerConnection.connectionState) {
                    case 'connected':
                        this.showNotification('Call connected', 'success');
                        break;
                    case 'disconnected':
                        this.showNotification('Connection lost', 'warning');
                        setTimeout(() => this.findNextPartner(), 2000);
                        break;
                    case 'failed':
                        this.showNotification('Call failed', 'error');
                        setTimeout(() => this.findNextPartner(), 2000);
                        break;
                    case 'closed':
                        console.log('Call ended');
                        break;
                }
            };
            
            // Handle ICE connection state
            this.peerConnection.oniceconnectionstatechange = () => {
                console.log('ICE connection state:', this.peerConnection.iceConnectionState);
                
                if (this.peerConnection.iceConnectionState === 'failed' ||
                    this.peerConnection.iceConnectionState === 'disconnected') {
                    setTimeout(() => this.findNextPartner(), 2000);
                }
            };
            
            // Create data channel for text chat
            this.dataChannel = this.peerConnection.createDataChannel('chat', {
                ordered: true,
                maxRetransmits: 3
            });
            
            this.setupDataChannel();
            
            // Create and send offer with timeout
            const offerOptions = {
                offerToReceiveAudio: true,
                offerToReceiveVideo: true
            };
            
            const offer = await this.peerConnection.createOffer(offerOptions);
            await this.peerConnection.setLocalDescription(offer);
            
            console.log('Sending offer');
            
            this.socket.send(JSON.stringify({
                type: 'offer',
                offer: offer,
                to: this.currentPartner.id
            }));
            
        } catch (error) {
            console.error('Error starting call:', error);
            this.showNotification('Error starting call. Trying again...', 'error');
            this.findNextPartner();
        }
    }
    
    async handleOffer(offer, from) {
        try {
            // Clean up previous connection
            if (this.peerConnection) {
                this.peerConnection.close();
            }
            
            this.peerConnection = new RTCPeerConnection(this.configuration);
            
            // Add local stream
            if (this.localStream) {
                this.localStream.getTracks().forEach(track => {
                    this.peerConnection.addTrack(track, this.localStream);
                });
            }
            
            // Handle remote stream
            this.peerConnection.ontrack = (event) => {
                console.log('Received remote track (answer side):', event.track.kind);
                
                if (!this.remoteStream) {
                    this.remoteStream = new MediaStream();
                }
                
                const existingTracks = this.remoteStream.getTracks();
                existingTracks.forEach(track => {
                    if (track.kind === event.track.kind) {
                        this.remoteStream.removeTrack(track);
                    }
                });
                
                this.remoteStream.addTrack(event.track);
                this.remoteVideo.srcObject = this.remoteStream;
            };
            
            // Handle ICE candidates
            this.peerConnection.onicecandidate = (event) => {
                if (event.candidate && this.socket) {
                    this.socket.send(JSON.stringify({
                        type: 'iceCandidate',
                        candidate: event.candidate,
                        to: from
                    }));
                }
            };
            
            // Handle connection state
            this.peerConnection.onconnectionstatechange = () => {
                console.log('Connection state (answer):', this.peerConnection.connectionState);
            };
            
            // Handle data channel
            this.peerConnection.ondatachannel = (event) => {
                this.dataChannel = event.channel;
                this.setupDataChannel();
            };
            
            // Set remote description
            await this.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
            
            // Create and send answer
            const answer = await this.peerConnection.createAnswer();
            await this.peerConnection.setLocalDescription(answer);
            
            console.log('Sending answer');
            
            this.socket.send(JSON.stringify({
                type: 'answer',
                answer: answer,
                to: from
            }));
            
        } catch (error) {
            console.error('Error handling offer:', error);
            this.showNotification('Error connecting to partner', 'error');
            this.findNextPartner();
        }
    }
    
    async handleAnswer(answer) {
        try {
            if (!this.peerConnection) {
                throw new Error('No peer connection');
            }
            
            const remoteDesc = new RTCSessionDescription(answer);
            await this.peerConnection.setRemoteDescription(remoteDesc);
            console.log('Remote description set successfully');
            
        } catch (error) {
            console.error('Error handling answer:', error);
            this.findNextPartner();
        }
    }
    
    async handleIceCandidate(candidate) {
        try {
            if (this.peerConnection && this.peerConnection.remoteDescription && candidate) {
                await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
                console.log('ICE candidate added');
            }
        } catch (error) {
            console.error('Error adding ICE candidate:', error);
        }
    }
    
    setupDataChannel() {
        if (!this.dataChannel) return;
        
        this.dataChannel.onopen = () => {
            console.log('✅ Data channel opened');
            this.showNotification('Chat connected', 'success');
        };
        
        this.dataChannel.onmessage = (event) => {
            this.receiveMessage(event.data, 'remote');
        };
        
        this.dataChannel.onclose = () => {
            console.log('Data channel closed');
        };
        
        this.dataChannel.onerror = (error) => {
            console.error('Data channel error:', error);
        };
    }
    
    sendMessage() {
        const message = this.messageInput.value.trim();
        if (!message) return;
        
        // Try data channel first
        if (this.dataChannel && this.dataChannel.readyState === 'open') {
            // Simple XOR encryption (in production use proper E2EE)
            const encrypted = this.encryptMessage(message);
            this.dataChannel.send(encrypted);
            
            // Display message locally
            this.displayMessage(message, 'self', new Date());
            this.messageInput.value = '';
            
        } else if (this.socket && this.socket.readyState === WebSocket.OPEN && this.currentPartner) {
            // Fallback to WebSocket
            this.socket.send(JSON.stringify({
                type: 'message',
                message: message
            }));
            
            this.displayMessage(message, 'self', new Date());
            this.messageInput.value = '';
            
        } else {
            this.showNotification('Chat not available', 'warning');
        }
    }
    
    receiveMessage(encryptedMessage, from, timestamp) {
        // Decrypt message
        const message = this.decryptMessage(encryptedMessage);
        
        if (from === 'remote') {
            this.displayMessage(message, 'remote', timestamp ? new Date(timestamp) : new Date());
        } else {
            // Message from server
            this.displayMessage(`System: ${message}`, 'system', new Date());
        }
    }
    
    displayMessage(message, sender, timestamp) {
        const messageElement = document.createElement('div');
        messageElement.className = `message ${sender}`;
        
        const timeStr = timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        messageElement.innerHTML = `
            <div class="message-content">${this.escapeHtml(message)}</div>
            <div class="message-time">${timeStr}</div>
        `;
        
        this.messagesContainer.appendChild(messageElement);
        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
    }
    
    encryptMessage(message) {
        // Simple XOR encryption (for demo only - use proper crypto in production)
        const key = 123;
        let encrypted = '';
        for (let i = 0; i < message.length; i++) {
            encrypted += String.fromCharCode(message.charCodeAt(i) ^ key);
        }
        return btoa(encrypted); // Base64 encode
    }
    
    decryptMessage(encrypted) {
        try {
            const decoded = atob(encrypted);
            const key = 123;
            let decrypted = '';
            for (let i = 0; i < decoded.length; i++) {
                decrypted += String.fromCharCode(decoded.charCodeAt(i) ^ key);
            }
            return decrypted;
        } catch (error) {
            return '[Encrypted message]';
        }
    }
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    endCall() {
        this.cleanupCurrentCall();
        this.findNextPartner();
        this.showNotification('Call ended. Finding next person...', 'info');
    }
    
    cleanupCurrentCall() {
        // Close peer connection
        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }
        
        // Clear data channel
        this.dataChannel = null;
        
        // Clear remote video
        if (this.remoteVideo.srcObject) {
            this.remoteVideo.srcObject.getTracks().forEach(track => {
                track.stop();
            });
            this.remoteVideo.srcObject = null;
        }
        
        this.remoteStream = null;
        this.currentPartner = null;
        
        // Clear messages
        this.messagesContainer.innerHTML = '';
        this.partnerName.textContent = 'Stranger';
        this.remoteLabel.textContent = 'Stranger';
    }
    
    async toggleVideo() {
        if (this.localStream) {
            const videoTrack = this.localStream.getVideoTracks()[0];
            if (videoTrack) {
                videoTrack.enabled = !videoTrack.enabled;
                this.toggleVideoBtn.classList.toggle('active', videoTrack.enabled);
                this.toggleVideoBtn.innerHTML = videoTrack.enabled ? 
                    '<i class="fas fa-video"></i>' : 
                    '<i class="fas fa-video-slash"></i>';
                
                this.showNotification(
                    videoTrack.enabled ? 'Video enabled' : 'Video disabled',
                    'info'
                );
                
                this.sendStreamStatus(videoTrack.enabled, 
                    this.localStream.getAudioTracks()[0]?.enabled || false);
            }
        }
    }
    
    async toggleAudio() {
        if (this.localStream) {
            const audioTrack = this.localStream.getAudioTracks()[0];
            if (audioTrack) {
                audioTrack.enabled = !audioTrack.enabled;
                this.toggleAudioBtn.classList.toggle('active', audioTrack.enabled);
                this.toggleAudioBtn.innerHTML = audioTrack.enabled ? 
                    '<i class="fas fa-microphone"></i>' : 
                    '<i class="fas fa-microphone-slash"></i>';
                
                this.showNotification(
                    audioTrack.enabled ? 'Microphone enabled' : 'Microphone disabled',
                    'info'
                );
                
                this.sendStreamStatus(
                    this.localStream.getVideoTracks()[0]?.enabled || false,
                    audioTrack.enabled
                );
            }
        }
    }
    
    showReportModal() {
        this.reportModal.style.display = 'flex';
        setTimeout(() => this.reportModal.classList.add('active'), 10);
    }
    
    hideReportModal() {
        this.reportModal.classList.remove('active');
        setTimeout(() => this.reportModal.style.display = 'none', 300);
    }
    
    submitReport() {
        const reason = document.getElementById('reportReason').value;
        const details = document.getElementById('reportDetails').value;
        
        if (this.currentPartner && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify({
                type: 'report',
                reason: reason,
                details: details
            }));
            
            this.hideReportModal();
        } else {
            this.showNotification('Cannot report at this time', 'error');
        }
    }
    
    showNotification(message, type = 'info') {
        const notification = document.getElementById('notification');
        
        // Set icon based on type
        let icon = 'info-circle';
        if (type === 'success') icon = 'check-circle';
        if (type === 'error') icon = 'exclamation-circle';
        if (type === 'warning') icon = 'exclamation-triangle';
        
        notification.innerHTML = `
            <i class="fas fa-${icon}"></i>
            <span>${message}</span>
        `;
        notification.className = `notification ${type}`;
        notification.style.display = 'flex';
        
        // Auto hide after 3 seconds
        setTimeout(() => {
            notification.style.display = 'none';
        }, 3000);
    }
}

// Initialize the video chat when page loads
document.addEventListener('DOMContentLoaded', () => {
    // Check for WebRTC support
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert('Your browser does not support video chat. Please use Chrome, Firefox, or Edge.');
        return;
    }
    
    // Check for WebSocket support
    if (!window.WebSocket) {
        alert('Your browser does not support WebSockets. Please use a modern browser.');
        return;
    }
    
    window.videoChat = new VideoChat();
    
    // Add admin panel link handler
    const adminLink = document.querySelector('.admin-link');
    if (adminLink) {
        adminLink.addEventListener('click', (e) => {
            if (!confirm('You will be redirected to admin panel. Continue?')) {
                e.preventDefault();
            }
        });
    }
    
    // Handle beforeunload
    window.addEventListener('beforeunload', () => {
        if (window.videoChat.socket) {
            window.videoChat.socket.send(JSON.stringify({ type: 'leave' }));
        }
    });
    
    // Auto focus on input fields
    document.addEventListener('click', (e) => {
        if (e.target.matches('input, textarea')) {
            e.target.focus();
        }
    });
});