import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import io from 'socket.io-client';
import './App.css';
import TitleBar from './TitleBar';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "http://localhost:5000";

function App() {
  const [socket, setSocket] = useState(null);
  const [username, setUsername] = useState('');
  const [tempUsername, setTempUsername] = useState('');
  const [message, setMessage] = useState('');
  const [room, setRoom] = useState('');
  const [showUsernameModal, setShowUsernameModal] = useState(false);
  const [showUsersModal, setShowUsersModal] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [isCheckingUsername, setIsCheckingUsername] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(null);
  const [pickerPosition, setPickerPosition] = useState({ top: 0, left: 0 });
  const [hoveredMessageId, setHoveredMessageId] = useState(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);

  const getMessageIdentifier = (msg) => msg._id || `${msg.author}-${msg.time}-${msg.message}`;
  const emojiPickerRef = useRef(null);
  const [channels, setChannels] = useState(['General', 'Sales', 'Marketing', 'Design', 'Tech']);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [newChannelName, setNewChannelName] = useState('');
  const [roomChats, setRoomChats] = useState({});
  const [typingUsers, setTypingUsers] = useState([]);
  const [password, setPassword] = useState('');
  const [liveUsers, setLiveUsers] = useState([]);
  const [userAvatar, setUserAvatar] = useState('');
  const [tempAvatar, setTempAvatar] = useState('');
  const [showAvatarModal, setShowAvatarModal] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  // const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef(null);
  const chatEndRef = useRef(null);
  const currentRoomRef = useRef(''); // Always holds the current room for use in socket reconnect

  useEffect(() => {
    console.log('Setting up socket connection...');
    const newSocket = io(BACKEND_URL);
    setSocket(newSocket);
    
    newSocket.on('connect', () => {
      console.log('Socket connected successfully:', newSocket.id);
      // Re-authenticate on every connect (covers page refresh + reconnects)
      const token = localStorage.getItem('token');
      const userData = localStorage.getItem('user');
      if (token && userData) {
        try {
          const user = JSON.parse(userData);
          newSocket.emit('authenticate', { token, user });
          // Re-join current room after reconnect (state-driven auto-join handles initial join)
          if (currentRoomRef.current) {
            setTimeout(() => newSocket.emit('join_room', currentRoomRef.current), 300);
          }
          // Fetch live users shortly after so server has time to process auth
          setTimeout(() => {
            fetch(`${BACKEND_URL}/api/live-users`)
              .then(r => r.json())
              .then(d => { if (d.users) setLiveUsers(d.users); })
              .catch(() => {});
          }, 600);
        } catch (e) {}
      }
    });
    
    newSocket.on('disconnect', () => {
      console.log('Socket disconnected');
    });
    
    newSocket.on('connect_error', (error) => {
      console.log('Socket connection error:', error);
    });

    newSocket.on('message', (data) => {
      console.log('Message received in frontend:', data);
      setRoomChats(prev => ({
        ...prev,
        [data.room]: [...(prev[data.room] || []), data]
      }));
    });

    newSocket.on('channel_created', (data) => {
      setChannels(prev => prev.includes(data.name) ? prev : [...prev, data.name]);
    });

    newSocket.on('channel_deleted', (data) => {
      setChannels(prev => prev.filter(c => c !== data.name));
    });

    newSocket.on('typing_users', (users) => {
      setTypingUsers(users);
    });

    newSocket.on('previous_messages', (data) => {
      const { messages, room: messageRoom } = data;
      setRoomChats(prev => ({
        ...prev,
        [messageRoom]: messages
      }));
    });

    newSocket.on('stop_typing', (data) => {
      setTypingUsers(prev => prev.filter(user => user !== data.username));
    });

    newSocket.on('user_joined', (data) => {
      console.log('User joined event received (handled via backend message broadcast):', data);
    });

    newSocket.on('user_kicked', (data) => {
      console.log('User kicked event received (handled via backend message broadcast):', data);
    });

    newSocket.on('kicked_notification', (data) => {
      console.log('Kicked notification received:', data);
      if (data && data.room) {
        // Show alert to user
        alert(data.message || `You were kicked from ${data.room}`);
        // Remove from current room if it's the one they were kicked from
        if (currentRoomRef.current === data.room) {
          setRoom('');
        }
      }
    });

    newSocket.on('kick_error', (data) => {
      console.log('Kick error received:', data);
      if (data && data.message) {
        alert(`Kick error: ${data.message}`);
      }
    });

    newSocket.on('reaction_added', (data) => {
      console.log('Reaction added event received:', data);
      setRoomChats(prev => {
        const roomMsgs = prev[data.room] || [];
        return {
          ...prev,
          [data.room]: roomMsgs.map(msg =>
            (getMessageIdentifier(msg) === data.messageId)
              ? {
                  ...msg,
                  reactions: [...(msg.reactions || []), {
                    emoji: data.emoji,
                    username: data.username,
                    timestamp: new Date()
                  }]
                }
              : msg
          )
        };
      });
    });

    newSocket.on('reaction_removed', (data) => {
      console.log('Reaction removed event received:', data);
      setRoomChats(prev => {
        const roomMsgs = prev[data.room] || [];
        return {
          ...prev,
          [data.room]: roomMsgs.map(msg =>
            (getMessageIdentifier(msg) === data.messageId)
              ? {
                  ...msg,
                  reactions: (msg.reactions || []).filter(
                    r => !(r.emoji === data.emoji && r.username === data.username)
                  )
                }
              : msg
          )
        };
      });
    });

    newSocket.on('live_users_update', (data) => {
      console.log('Live users update received:', data);
      setLiveUsers(data.users);
    });

    newSocket.on('message_deleted', (data) => {
      console.log('Message deleted event received:', data);
      setRoomChats(prev => {
        const roomMsgs = prev[data.room] || [];
        return {
          ...prev,
          [data.room]: roomMsgs.filter(msg => getMessageIdentifier(msg) !== data.messageId)
        };
      });
    });

    newSocket.on('message_preview_update', (data) => {
      console.log('Link preview update received:', data);
      setRoomChats(prev => {
        const result = { ...prev };
        Object.keys(result).forEach(roomName => {
          result[roomName] = result[roomName].map(msg => 
            getMessageIdentifier(msg) === data.messageId 
              ? { ...msg, linkPreview: data.linkPreview } 
              : msg
          );
        });
        return result;
      });
    });

    return () => newSocket.close();
  }, []);

  // Close emoji picker on click outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target)) {
        setShowEmojiPicker(null);
      }
    };
    if (showEmojiPicker) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showEmojiPicker]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    const userData = localStorage.getItem('user');
    
    if (token && userData) {
      try {
        const user = JSON.parse(userData);
        setUsername(user.username);
        setUserAvatar(user.avatar || '');
        setIsAdmin(user.isAdmin || false);
        setIsLoggedIn(true);
        // Fetch fresh channels on restore
        fetchChannels();
      } catch (error) {
        console.error('Error parsing user data:', error);
        localStorage.removeItem('token');
        localStorage.removeItem('user');
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-join General channel when user logs in and socket is ready
  useEffect(() => {
    if (isLoggedIn && socket && !room) {
      const defaultRoom = 'General';
      console.log('Auto-joining default channel:', defaultRoom);
      currentRoomRef.current = defaultRoom;
      setRoom(defaultRoom);
      // Emit join_room with a small delay to allow authenticate to be processed
      setTimeout(() => {
        socket.emit('join_room', defaultRoom);
      }, 500);
    }
  }, [isLoggedIn, socket]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [roomChats, room, typingUsers]);

  useEffect(() => {
    let typingTimeout;
    if (message && socket && room) {
      typingTimeout = setTimeout(() => {
        socket.emit('stop_typing', {room, username});
      }, 1000);
    }
    return () => clearTimeout(typingTimeout);
  }, [message, socket, room, username]);

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (file) {
      setSelectedFile(file);
    }
  };

  const uploadFile = async () => {
    if (!selectedFile) return null;
    
    setIsUploading(true);
    // setUploadProgress(0);
    
    const formData = new FormData();
    formData.append('file', selectedFile);
    
    try {
      const response = await fetch(`${BACKEND_URL}/api/upload`, {
        method: 'POST',
        body: formData,
      });
      
      if (!response.ok) throw new Error('Upload failed');
      
      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Upload error:', error);
      alert('Failed to upload file');
      return null;
    } finally {
      setIsUploading(false);
      setSelectedFile(null);
    }
  };

  const sendMessage = async () => {
    console.log('sendMessage called:', { message, room, username, socketConnected: !!socket });
    
    let fileData = null;
    if (selectedFile) {
      fileData = await uploadFile();
      if (!fileData) return; // Stop if upload failed
    }

    if ((message.trim() || fileData) && socket && room) {
      const messageData = {
        message: message,
        author: username,
        room: room,
        timestamp: new Date().toISOString(),
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        fileUrl: fileData ? fileData.fileUrl : null,
        fileName: fileData ? fileData.fileName : null,
        fileType: fileData ? fileData.fileType : null
      };
      
      console.log('Sending message data:', messageData);
      
      socket.emit('message', messageData);
      socket.emit('stop_typing', {room, username});
      setMessage('');
      setSelectedFile(null);
      console.log('Message sent to server');
    }
  };

  const handleLogin = async () => {
    if (!tempUsername.trim() || !password.trim()) {
      setLoginError('Please enter username and password');
      return;
    }
    
    setIsCheckingUsername(true);
    setLoginError('');
    
    try {
      const email = tempUsername.trim();
      
      const response = await fetch(`${BACKEND_URL}/api/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: email,
          password: password.trim()
        })
      });

      const data = await response.json();

      if (response.ok) {
        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify(data.user));
        
        setUsername(data.user.username);
        setUserAvatar(data.user.avatar || '');
        setIsAdmin(data.user.isAdmin || false);
        setIsLoggedIn(true);
        setIsCheckingUsername(false);
        setTempUsername('');
        setPassword('');
        setTempAvatar('');
        
        if (socket) {
          socket.emit('authenticate', {
            token: data.token,
            user: data.user
          });
        }
        
        // Delay fetch so server processes authenticate event first
        setTimeout(fetchLiveUsers, 800);
        fetchChannels();
      } else {
        const registerResponse = await fetch(`${BACKEND_URL}/api/register`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            username: tempUsername.trim(),
            email: email,
            password: password.trim(),
            avatar: tempAvatar.trim() || null
          })
        });

        const registerData = await registerResponse.json();
        
        if (registerResponse.ok) {
          localStorage.setItem('token', registerData.token);
          localStorage.setItem('user', JSON.stringify(registerData.user));
          
          setUsername(registerData.user.username);
          setUserAvatar(registerData.user.avatar || '');
          setIsAdmin(registerData.user.isAdmin || false);
          setIsLoggedIn(true);
          setIsCheckingUsername(false);
          setTempUsername('');
          setPassword('');
          setTempAvatar('');
          
          if (socket) {
            socket.emit('authenticate', {
              token: registerData.token,
              user: registerData.user
            });
          }
          
          // Delay fetch so server processes authenticate event first
          setTimeout(fetchLiveUsers, 800);
          fetchChannels();
        } else {
          setLoginError(registerData.message || 'Registration failed');
          setIsCheckingUsername(false);
        }
      }
    } catch (error) {
      console.error('Login error:', error);
      setLoginError('Server error. Please try again.');
      setIsCheckingUsername(false);
    }
  };

  const handleLogout = () => {
    setIsLoggedIn(false);
    setUsername('');
    setRoom('');
    setRoomChats({});
    setPassword('');
    setUserAvatar('');
    setTempAvatar('');
    setIsAdmin(false);
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    
    // Clear chats on logout
    setRoomChats({});
  };

  const changeUsername = () => {
    if (tempUsername.trim()) {
      setUsername(tempUsername);
      setShowUsernameModal(false);
      setTempUsername('');
    }
  };

  const changeAvatar = () => {
    if (tempAvatar.trim()) {
      setUserAvatar(tempAvatar);
      setShowAvatarModal(false);
      setTempAvatar('');
      const currentUser = JSON.parse(localStorage.getItem('user') || '{}');
      currentUser.avatar = tempAvatar;
      localStorage.setItem('user', JSON.stringify(currentUser));
    }
  };



  const joinRoom = (channel) => {
    console.log('joinRoom called for channel:', channel, 'current room:', room);
    if (room === channel) {
      console.log('Already joined room:', channel);
      return;
    }
    setRoom(channel);
    currentRoomRef.current = channel;
    if (socket) {
      socket.emit("join_room", channel);
    }
  };

  const fetchLiveUsers = async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/live-users`, {
        headers: { 'Content-Type': 'application/json' },
      });
      if (response.ok) {
        const data = await response.json();
        setLiveUsers(data.users);
      }
    } catch (error) {
      console.error('Error fetching live users:', error);
    }
  };

  const fetchChannels = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/channels`);
      if (res.ok) {
        const data = await res.json();
        if (data.channels && data.channels.length > 0) setChannels(data.channels);
      }
    } catch (e) { /* keep defaults */ }
  };

  const createChannel = async () => {
    const name = newChannelName.trim();
    if (!name) return;
    const token = localStorage.getItem('token');
    try {
      const res = await fetch(`${BACKEND_URL}/api/channels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ name })
      });
      if (res.ok) {
        setNewChannelName('');
      } else {
        const d = await res.json();
        alert(d.message || 'Failed to create channel');
      }
    } catch (e) { alert('Server error'); }
  };

  const deleteChannel = async (name) => {
    const token = localStorage.getItem('token');
    try {
      const res = await fetch(`${BACKEND_URL}/api/channels/${encodeURIComponent(name)}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) {
        const d = await res.json();
        alert(d.message || 'Failed to delete channel');
      }
    } catch (e) { alert('Server error'); }
  };

  const addReaction = (messageId, emoji) => {
    if (socket && room) {
      socket.emit('add_reaction', {
        messageId: messageId,
        emoji: emoji,
        username: username,
        room: room
      });
    }
  };

  const removeReaction = (messageId, emoji) => {
    if (socket && room) {
      socket.emit('remove_reaction', {
        messageId: messageId,
        emoji: emoji,
        username: username,
        room: room
      });
    }
  };

  const toggleReaction = (messageId, emoji) => {
    const message = (roomChats[room] || []).find(msg => getMessageIdentifier(msg) === messageId);
    if (message && message.reactions) {
      const hasReacted = message.reactions.some(r => r.emoji === emoji && r.username === username);
      if (hasReacted) {
        removeReaction(messageId, emoji);
      } else {
        addReaction(messageId, emoji);
      }
    } else {
      addReaction(messageId, emoji);
    }
  };

  const deleteMessage = (messageId) => {
    if (socket && room && messageId) {
      socket.emit("delete_message", {
        messageId: messageId,
        room: room,
        username: username
      });
      setDeleteConfirmId(null);
    }
  };



  const hasUserReacted = (reactions, emoji) => {
    if (!reactions) return false;
    return reactions.some(r => r.emoji === emoji && r.username === username);
  };

  const kickUser = (usernameToKick) => {
    if (socket && room && usernameToKick !== username) {
      socket.emit('kick_user', {
        room: room,
        usernameToKick: usernameToKick
      });
    }
  };

  const commonEmojis = ['👍', '❤️', '😂', '😮', '😢', '😡', '🎉', '🔥', '👀', '✅', '😍', '🙏', '💯', '🚀', '😎', '🤔', '🌟', '👏', '🙌', '💡'];

  const renderReactions = (message) => {
    const hasReactions = message.reactions && message.reactions.length > 0;

    if (!hasReactions) return null;

    const emojiCounts = {};
    if (hasReactions) {
      message.reactions.forEach(reaction => {
        if (!emojiCounts[reaction.emoji]) emojiCounts[reaction.emoji] = [];
        emojiCounts[reaction.emoji].push(reaction.username);
      });
    }

    return (
      <div className="reactions-container">
        {Object.entries(emojiCounts).map(([emoji, users]) => (
          <button
            key={emoji}
            className={`reaction-btn ${hasUserReacted(message.reactions, emoji) ? 'reacted' : ''}`}
            onClick={() => toggleReaction(getMessageIdentifier(message), emoji)}
            title={`${emoji} · ${users.join(', ')}`}
          >
            <span className="reaction-emoji">{emoji}</span>
            <span className="reaction-count">{users.length}</span>
          </button>
        ))}
      </div>
    );
  };

  const renderMessageActions = (message) => {
    const msgId = getMessageIdentifier(message);
    const isHovered = hoveredMessageId === msgId;
    const isPickerOpen = showEmojiPicker === msgId;
    const isDeleting = deleteConfirmId === msgId;

    if (!isHovered && !isPickerOpen) return null;

    return (
      <div className={`message-actions-wrapper ${isDeleting ? 'is-confirming' : ''}`}>
        <div className="message-actions">
          <button
            className={`action-btn ${isPickerOpen ? 'active' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              if (isPickerOpen) {
                setShowEmojiPicker(null);
              } else {
                const rect = e.currentTarget.getBoundingClientRect();
                setPickerPosition({ top: rect.bottom + window.scrollY, left: Math.max(10, rect.left - 200 + window.scrollX) });
                setShowEmojiPicker(msgId);
              }
            }}
            title="Add reaction"
          >
            ➕
          </button>
          {message.author === username && (
            <button
              className={`action-btn delete-btn ${isDeleting ? 'confirming' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                if (isDeleting) {
                  deleteMessage(msgId);
                } else {
                  setDeleteConfirmId(msgId);
                  // Auto-cancel after 3 seconds
                  setTimeout(() => setDeleteConfirmId(null), 3000);
                }
              }}
              title={isDeleting ? "Click again to confirm" : "Delete Message"}
            >
              {isDeleting ? "Confirm?" : "🗑️"}
            </button>
          )}
        </div>
      </div>
    );
  };

  const renderLinkPreview = (message) => {
    const preview = message.linkPreview;
    if (!preview) return null;

    return (
      <div className="link-preview-card" onClick={() => window.open(preview.url, '_blank')}>
        {preview.image && (
          <div className="link-preview-image">
            <img src={preview.image} alt={preview.title} onError={(e) => e.target.style.display = 'none'} />
          </div>
        )}
        <div className="link-preview-content">
          {preview.siteName && <div className="link-preview-site">{preview.siteName}</div>}
          <div className="link-preview-title">{preview.title}</div>
          {preview.description && <div className="link-preview-description">{preview.description}</div>}
        </div>
      </div>
    );
  };

  const getUserAvatar = (author) => {
    if (liveUsers && liveUsers.length > 0) {
      const user = liveUsers.find(u => u.username === author);
      if (user && user.avatar) return user.avatar;
    }
    if (author === username && userAvatar) return userAvatar;
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(author)}&background=random`;
  };

  return (
    <div className="App">
      <TitleBar />
      {!isLoggedIn ? (
        <div className="login-container">
          <div className="login-panel">
            <div className="login-header">
              <div className="instagram-logo">
                <div className="logo-gradient">Felic</div>
                <div className="logo-text">Chat</div>
              </div>
              <h2>Welcome to Felic Chat</h2>
              <p>Connect with friends and join channels</p>
            </div>
            
            <div className="login-form">
              <div className="input-group">
                <input 
                  type="text" 
                  placeholder="Enter your email or username"
                  value={tempUsername}
                  onChange={(e) => {
                    setTempUsername(e.target.value.toLowerCase());
                    setLoginError('');
                  }}
                  onKeyPress={(e) => e.key === 'Enter' && handleLogin()}
                  className={`login-input ${loginError ? 'error' : ''}`}
                  disabled={isCheckingUsername}
                />
                <div style={{ height: '12px' }}></div>
                <input 
                  type="password" 
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setLoginError('');
                  }}
                  onKeyPress={(e) => e.key === 'Enter' && handleLogin()}
                  className={`login-input ${loginError ? 'error' : ''}`}
                  disabled={isCheckingUsername}
                />
                <div style={{ height: '12px' }}></div>
                <input 
                  type="text" 
                  placeholder="Avatar (optional)"
                  value={tempAvatar}
                  onChange={(e) => {
                    setTempAvatar(e.target.value);
                    setLoginError('');
                  }}
                  onKeyPress={(e) => e.key === 'Enter' && handleLogin()}
                  className={`login-input ${loginError ? 'error' : ''}`}
                  disabled={isCheckingUsername}
                />
                {loginError && <div className="error-message">{loginError}</div>}
              </div>
              <button 
                onClick={handleLogin}
                disabled={!tempUsername.trim() || !password.trim() || isCheckingUsername}
                className="login-button"
              >
                {isCheckingUsername ? 'Checking...' : 'Continue'}
              </button>
              <div className="login-rules">
                <p>Login requirements:</p>
                <ul>
                  <li>At least 3 characters</li>
                  <li>Letters, numbers, and underscores only</li>
                  <li>Must be unique</li>
                  <li>Password: At least 6 characters</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <header className="App-header">
          <div className="header-top">
            <div className="header-title">
              <h1>Felic Chat</h1>
              <img 
                src="/chat-logo.png" 
                alt="Chat Logo" 
                className="chat-logo"
                onError={(e) => {
                  e.target.style.display = 'none';
                }}
              />
            </div>
            <div className="header-controls">
              <button 
                className="username-btn" 
                onClick={() => setShowUsernameModal(true)}
              >
                👤 {username}
              </button>
              <button 
                className="users-btn" 
                onClick={() => {
                  setShowUsersModal(true);
                  fetchLiveUsers();
                }}
              >
                👥 Live Users ({liveUsers ? liveUsers.length : 0})
              </button>
              {room && <span className="current-room">#{room}</span>}
              {isAdmin && (
                <button
                  className="admin-btn"
                  onClick={() => setShowAdminPanel(true)}
                  title="Admin Panel"
                >
                  ⚙️ Admin
                </button>
              )}
            </div>
          </div>
          <div className="chat-container">
            <div className="sidebar">
              <div className="sidebar-header">
                <h3>Channels</h3>
              </div>
              <div className="channels-list">
                {channels.map((channel) => (
                  <div
                    key={channel}
                    className={`channel-item ${room === channel ? 'active' : ''}`}
                    onClick={() => joinRoom(channel)}
                  >
                    <span className="channel-hash">#</span>
                    <span className="channel-name">{channel}</span>
                    {room === channel && <span className="active-indicator">●</span>}
                  </div>
                ))}
              </div>
            </div>
            <div className="main-chat">
              <div className="messages">
                {(roomChats[room] || []).map((msg, index) => (
                  <div
                    key={index}
                    className={`message ${msg.author === username ? 'sent' : msg.author === 'System' ? 'system' : 'received'}`}
                    onMouseEnter={() => setHoveredMessageId(getMessageIdentifier(msg))}
                    onMouseLeave={() => setHoveredMessageId(null)}
                  >
                    {msg.author !== 'System' && (
                      <div className="message-avatar">
                        <img 
                          src={getUserAvatar(msg.author)} 
                          alt={msg.author}
                          onError={(e) => {
                            e.target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(msg.author)}&background=random`;
                          }}
                        />
                      </div>
                    )}
                    <div className="message-content-wrapper">
                      {msg.author !== 'System' && (
                        <div className="message-header">
                          <span className="message-author">{msg.author}</span>
                          <span className="message-time">{msg.time}</span>
                        </div>
                      )}
                      <div className="message-content">{msg.message}</div>
                      {msg.fileUrl && (
                        <div className="file-attachment">
                          {msg.fileType && msg.fileType.startsWith('image/') ? (
                            <img 
                              src={msg.fileUrl} 
                              alt={msg.fileName} 
                              className="image-attachment"
                              onClick={() => window.open(msg.fileUrl, '_blank')}
                            />
                          ) : (
                            <a 
                              href={msg.fileUrl} 
                              target="_blank" 
                              rel="noopener noreferrer" 
                              className="document-attachment"
                            >
                              <span className="file-icon">📄</span>
                              <div className="file-info">
                                <span className="file-name">{msg.fileName}</span>
                                <span className="file-meta">Click to download</span>
                              </div>
                            </a>
                          )}
                        </div>
                      )}
                      {msg.author !== 'System' && renderReactions(msg)}
                      {msg.linkPreview && renderLinkPreview(msg)}
                      {msg.author !== 'System' && renderMessageActions(msg)}
                    </div>
                  </div>
                ))}
                {typingUsers.length > 0 && (
                  <div className="typing-indicator">
                    <span className="typing-text">
                      {typingUsers.join(', ')} {typingUsers.length === 1 ? 'is' : 'are'} typing...
                    </span>
                    <div className="typing-dots">
                      <span></span>
                      <span></span>
                      <span></span>
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>
              <div className="message-input-container">
                {selectedFile && (
                  <div className="upload-preview">
                    {selectedFile.type.startsWith('image/') ? (
                      <img 
                        src={URL.createObjectURL(selectedFile)} 
                        alt="Preview" 
                        className="preview-thumb" 
                      />
                    ) : (
                      <span className="file-icon">📄</span>
                    )}
                    <div className="preview-info">
                      {selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)
                    </div>
                    <button className="remove-preview" onClick={() => setSelectedFile(null)}>×</button>
                  </div>
                )}
                <div className="message-input">
                  <input 
                    type="file" 
                    ref={fileInputRef} 
                    style={{ display: 'none' }} 
                    onChange={handleFileSelect}
                  />
                  <button 
                    className="attach-btn" 
                    onClick={() => fileInputRef.current.click()}
                  >
                    📎
                  </button>
                  <input 
                    type="text" 
                    placeholder="Type a message..." 
                    value={message}
                    onChange={(e)=>{
                      setMessage(e.target.value);
                      if (socket && room) socket.emit("typing", {room, username});
                    }}
                    onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                    className="message-input-field"
                  />
                  <button onClick={sendMessage} disabled={isUploading}>
                    {isUploading ? (
                      <div className="loading-dots">
                        <span></span><span></span><span></span>
                      </div>
                    ) : 'Send'}
                  </button>
                </div>
              </div>
            </div>
          </div>
          <button 
            className="logout-btn-fixed" 
            onClick={handleLogout}
          >
            Logout
          </button>
        </header>
      )}
      {showUsernameModal && (
        <div className="modal-overlay">
          <div className="modal">
            <h3>Change Username</h3>
            <input 
              type="text" 
              placeholder="Enter new username" 
              value={tempUsername}
              onChange={(e) => setTempUsername(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && changeUsername()}
            />
            <div className="modal-buttons">
              <button onClick={changeUsername}>Change</button>
              <button onClick={() => setShowUsernameModal(false)}>Cancel</button>
              <button onClick={() => setShowAvatarModal(true)}>Change Avatar</button>
            </div>
          </div>
        </div>
      )}
      {showAvatarModal && (
        <div className="modal-overlay">
          <div className="modal">
            <h3>Change Avatar</h3>
            <div className="avatar-preview">
              <img 
                src={tempAvatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(username)}&background=random`} 
                alt="Avatar Preview" 
                className="avatar-preview-img"
                onError={(e) => {
                  e.target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(username)}&background=random`;
                }}
              />
            </div>
            <input 
              type="text" 
              placeholder="Enter avatar URL" 
              value={tempAvatar}
              onChange={(e) => setTempAvatar(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && changeAvatar()}
            />
            <div className="modal-buttons">
              <button onClick={changeAvatar}>Change</button>
              <button onClick={() => setShowAvatarModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      {showUsersModal && (
        <div className="modal-overlay">
          <div className="modal users-modal">
            <h3>Live Users ({liveUsers ? liveUsers.length : 0})</h3>
            <div className="users-list">
              {(liveUsers || []).map((user) => (
                <div key={user.id} className="user-card">
                  <div className="user-avatar">
                    <img 
                      src={user.avatar} 
                      alt={user.username}
                      onError={(e) => {
                        e.target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(user.username)}&background=random`;
                      }}
                    />
                    <div className="live-indicator">🟢 LIVE</div>
                  </div>
                  <div className="user-info">
                    <div className="user-name">{user.username}</div>
                    <div className="user-email">{user.email}</div>
                    <div className="user-status">
                      <span className={`status-indicator ${user.isActive ? 'active' : 'inactive'}`}></span>
                      {user.isActive ? 'Active' : 'Inactive'}
                    </div>
                  </div>
                  {room && user.username !== username && (
                    <button 
                      className="kick-btn"
                      onClick={() => kickUser(user.username)}
                      title={`Kick ${user.username} from ${room}`}
                    >
                      👢 Kick
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div className="modal-buttons">
              <button onClick={() => setShowUsersModal(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
      {showAdminPanel && (
        <div className="modal-overlay" onClick={() => setShowAdminPanel(false)}>
          <div className="admin-panel" onClick={e => e.stopPropagation()}>
            <div className="admin-panel-header">
              <h2>⚙️ Admin Panel</h2>
              <button className="modal-close-btn" onClick={() => setShowAdminPanel(false)}>✕</button>
            </div>

            <div className="admin-section">
              <h3 className="admin-section-title">👥 Kick Users</h3>
              <div className="admin-user-list">
                {liveUsers.filter(u => u.username !== username).length === 0 && (
                  <div className="admin-empty">No other users online</div>
                )}
                {liveUsers.filter(u => u.username !== username).map(user => (
                  <div key={user.id} className="admin-user-row">
                    <img
                      src={user.avatar}
                      alt={user.username}
                      className="admin-user-avatar"
                      onError={e => e.target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(user.username)}&background=random`}
                    />
                    <span className="admin-user-name">{user.username}</span>
                    <button
                      className="admin-kick-btn"
                      onClick={() => { kickUser(user.username); }}
                    >
                      👢 Kick
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="admin-divider" />

            <div className="admin-section">
              <h3 className="admin-section-title">📢 Manage Channels</h3>
              <div className="admin-channel-create">
                <input
                  className="admin-channel-input"
                  type="text"
                  placeholder="New channel name..."
                  value={newChannelName}
                  onChange={e => setNewChannelName(e.target.value)}
                  onKeyPress={e => e.key === 'Enter' && createChannel()}
                />
                <button className="admin-create-btn" onClick={createChannel}>+ Create</button>
              </div>
              <div className="admin-channel-list">
                {channels.map(ch => (
                  <div key={ch} className="admin-channel-row">
                    <span className="admin-channel-hash">#</span>
                    <span className="admin-channel-name">{ch}</span>
                    {ch !== 'General' && (
                      <button
                        className="admin-delete-btn"
                        onClick={() => deleteChannel(ch)}
                        title={`Delete #${ch}`}
                      >✕</button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
      {showEmojiPicker && createPortal(
        <div 
          className="emoji-picker-container" 
          ref={emojiPickerRef}
          style={{ top: pickerPosition.top, left: pickerPosition.left, position: 'absolute', zIndex: 10000 }}
        >
          <div className="emoji-picker">
            {commonEmojis.map(emoji => (
              <button
                key={emoji}
                className="emoji-option"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleReaction(showEmojiPicker, emoji);
                  setShowEmojiPicker(null);
                }}
                title={emoji}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

export default App;
