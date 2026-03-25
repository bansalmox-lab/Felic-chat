import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import './App.css';

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
  const [hoveredMessageId, setHoveredMessageId] = useState(null);
  const emojiPickerRef = useRef(null);
  const channels = ['General', 'Sales', 'Marketing', 'Design', 'Tech'];
  const [roomChats, setRoomChats] = useState({});
  const [typingUsers, setTypingUsers] = useState([]);
  const [password, setPassword] = useState('');
  const [liveUsers, setLiveUsers] = useState([]);
  const [userAvatar, setUserAvatar] = useState('');
  const [tempAvatar, setTempAvatar] = useState('');
  const [showAvatarModal, setShowAvatarModal] = useState(false);
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
          // Re-join current room so messages still work after reconnect
          if (currentRoomRef.current) {
            newSocket.emit('join_room', currentRoomRef.current);
          }
          // Fetch live users shortly after so server has time to process auth
          setTimeout(() => {
            fetch(`${BACKEND_URL}/api/live-users`)
              .then(r => r.json())
              .then(d => { if (d.users) setLiveUsers(d.users); })
              .catch(() => {});
          }, 500);
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
      setTypingUsers(typingUsers.filter(user => user !== data.username));
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
            (msg._id && msg._id === data.messageId)
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
            (msg._id && msg._id === data.messageId)
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
        setIsLoggedIn(true);
      } catch (error) {
        console.error('Error parsing user data:', error);
        localStorage.removeItem('token');
        localStorage.removeItem('user');
      }
    }
  }, []);

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

  const sendMessage = () => {
    console.log('sendMessage called:', { message, room, username, socketConnected: !!socket });
    if (message.trim() && socket && room) {
      const messageData = {
        message: message,
        author: username,
        room: room,
        timestamp: new Date().toISOString(),
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      
      console.log('Sending message data:', messageData);
      
      // Send to server for broadcasting to all users and saving to database
      socket.emit('message', messageData);
      socket.emit('stop_typing', {room, username});
      setMessage('');
      console.log('Message sent to server');
    } else {
      console.log('Message not sent - missing data:', { 
        hasMessage: !!message.trim(), 
        hasSocket: !!socket, 
        hasRoom: !!room 
      });
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
        setTimeout(fetchLiveUsers, 600);
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
          setTimeout(fetchLiveUsers, 600);
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

  const openAvatarModal = () => {
    const currentUser = JSON.parse(localStorage.getItem('user') || '{}');
    setUserAvatar(currentUser.avatar || '');
    setTempAvatar(currentUser.avatar || '');
    setShowAvatarModal(true);
  };

  const joinRoom = (channel) => {
    console.log('joinRoom called for channel:', channel, 'current room:', room);
    if (room === channel) {
      console.log('Already joined room:', channel);
      return;
    }
    setRoom(channel);
    if (socket) {
      socket.emit("join_room", channel);
    }
  };

  const fetchLiveUsers = async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/live-users`, {
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        const data = await response.json();
        setLiveUsers(data.users);
      }
    } catch (error) {
      console.error('Error fetching live users:', error);
    }
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
    const message = (roomChats[room] || []).find(msg => msg._id === messageId);
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

  const getReactionUsers = (reactions, emoji) => {
    if (!reactions) return [];
    return reactions.filter(r => r.emoji === emoji).map(r => r.username);
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

  const commonEmojis = ['👍', '❤️', '😂', '😮', '😢', '😡', '🎉', '🔥', '👀', '✅', '😍', '🙏', '💯', '🚀', '😎', '🤔'];

  const renderReactions = (message) => {
    const hasReactions = message.reactions && message.reactions.length > 0;
    const isHovered = hoveredMessageId === message._id;
    const isPickerOpen = showEmojiPicker === message._id;

    // Only render the block if hovered, picker open, or there are existing reactions
    if (!hasReactions && !isHovered && !isPickerOpen) return null;

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
            onClick={() => message._id && toggleReaction(message._id, emoji)}
            title={`${emoji} · ${users.join(', ')}`}
          >
            <span className="reaction-emoji">{emoji}</span>
            <span className="reaction-count">{users.length}</span>
          </button>
        ))}

        {/* Add-reaction trigger — shown on hover or when picker is open */}
        {(isHovered || isPickerOpen || hasReactions) && message._id && (
          <button
            className={`add-reaction-btn ${isPickerOpen ? 'active' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              setShowEmojiPicker(isPickerOpen ? null : message._id);
            }}
            title="Add reaction"
          >
            😊
          </button>
        )}

        {/* Inline emoji picker */}
        {isPickerOpen && (
          <div className="emoji-picker" ref={emojiPickerRef}>
            {commonEmojis.map(emoji => (
              <button
                key={emoji}
                className="emoji-option"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleReaction(message._id, emoji);
                  setShowEmojiPicker(null);
                }}
                title={emoji}
              >
                {emoji}
              </button>
            ))}
          </div>
        )}
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
                    setTempUsername(e.target.value);
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
                    onMouseEnter={() => msg._id && setHoveredMessageId(msg._id)}
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
                      {msg.author !== 'System' && renderReactions(msg)}
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
              <div className="message-input">
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
                <button onClick={sendMessage}>Send</button>
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
    </div>
  );
}

export default App;
