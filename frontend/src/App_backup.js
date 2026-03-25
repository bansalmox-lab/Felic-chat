import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import './App.css';

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
  const channels = ['General', 'Sales', 'Marketing', 'Design', 'Tech'];
  const [roomChats, setRoomChats] = useState({});
  const [typingUsers, setTypingUsers] = useState([]);
  const [password, setPassword] = useState('');
  const [liveUsers, setLiveUsers] = useState([]);
  const [userAvatar, setUserAvatar] = useState('');
  const [tempAvatar, setTempAvatar] = useState('');
  const [showAvatarModal, setShowAvatarModal] = useState(false);
  const chatEndRef = useRef(null);
  const joinedUsersRef = useRef(new Map()); // Track users who have joined each room

  useEffect(() => {
    const newSocket = io('http://localhost:5000');
    setSocket(newSocket);

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
      console.log('User joined event received:', data);
      if (data && data.username && data.room) {
        // Check if we've already seen this user join this room
        const roomKey = data.room;
        const userKey = data.username;
        
        console.log('Checking for duplicate:', roomKey, userKey);
        console.log('Current joined users:', Array.from(joinedUsersRef.current.entries()));
        
        if (!joinedUsersRef.current.has(roomKey)) {
          joinedUsersRef.current.set(roomKey, new Set());
          console.log('Created new room tracking for:', roomKey);
        }
        
        const roomUsers = joinedUsersRef.current.get(roomKey);
        console.log('Room users for', roomKey, ':', Array.from(roomUsers));
        
        // Only show notification if we haven't seen this user join before
        if (!roomUsers.has(userKey)) {
          console.log('Showing join notification for:', userKey);
          roomUsers.add(userKey);
          
          const joinMessage = {
            message: `${data.username} joined the chat! 🎉`,
            author: 'System',
            room: data.room,
            timestamp: new Date().toISOString(),
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            isSystemMessage: true
          };
          
          setRoomChats(prev => ({
            ...prev,
            [data.room]: [...(prev[data.room] || []), joinMessage]
          }));
        } else {
          console.log('Skipping duplicate notification for:', userKey, 'in room:', roomKey);
        }
      }
    });

    newSocket.on('user_kicked', (data) => {
      console.log('User kicked event received:', data);
      if (data && data.username && data.room) {
        const kickMessage = {
          message: `${data.username} was kicked from the room! 👢`,
          author: 'System',
          room: data.room,
          timestamp: new Date().toISOString(),
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          isSystemMessage: true
        };
        
        setRoomChats(prev => ({
          ...prev,
          [data.room]: [...(prev[data.room] || []), kickMessage]
        }));
      }
    });

    newSocket.on('kicked_notification', (data) => {
      console.log('Kicked notification received:', data);
      if (data && data.room) {
        // Show alert to user
        alert(data.message || `You were kicked from ${data.room}`);
        // Remove from current room if it's the one they were kicked from
        if (room === data.room) {
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
      setRoomChats(prev => ({
        ...prev,
        [data.room]: prev[data.room].map(msg => 
          msg._id === data.messageId 
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
      }));
    });

    newSocket.on('reaction_removed', (data) => {
      console.log('Reaction removed event received:', data);
      setRoomChats(prev => ({
        ...prev,
        [data.room]: prev[data.room].map(msg => 
          msg._id === data.messageId 
            ? { 
                ...msg, 
                reactions: (msg.reactions || []).filter(
                  r => !(r.emoji === data.emoji && r.username === data.username)
                )
              }
            : msg
        )
      }));
    });

    newSocket.on('live_users_update', (data) => {
      console.log('Live users update received:', data);
      setLiveUsers(data.users);
    });

    return () => newSocket.close();
  }, []);

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
      
      const response = await fetch('http://localhost:5000/api/login', {
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
        
        fetchLiveUsers();
      } else {
        const registerResponse = await fetch('http://localhost:5000/api/register', {
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
          
          fetchLiveUsers();
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
    
    // Clear joined users tracking
    joinedUsersRef.current.clear();
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
      if (!roomChats[channel] || !roomChats[channel].length) {
        setRoomChats(prev => ({
          ...prev,
          [channel]: [{ 
            message: `You joined #${channel}!`, 
            author: 'System', 
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
          }]
        }));
      }
    }
  };

  const fetchLiveUsers = async () => {
    try {
      const response = await fetch('http://localhost:5000/api/live-users', {
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
      if (window.confirm(`Are you sure you want to kick ${usernameToKick} from ${room}?`)) {
        socket.emit('kick_user', {
          room: room,
          usernameToKick: usernameToKick
        });
      }
    }
  };

  const commonEmojis = ['👍', '❤️', '😂', '😮', '😢', '😡'];

  const renderReactions = (message) => {
    if (!message.reactions || message.reactions.length === 0) return null;
    
    const emojiCounts = {};
    message.reactions.forEach(reaction => {
      if (!emojiCounts[reaction.emoji]) {
        emojiCounts[reaction.emoji] = [];
      }
      emojiCounts[reaction.emoji].push(reaction.username);
    });
    
    return (
      <div className="reactions-container">
        {Object.entries(emojiCounts).map(([emoji, users]) => (
          <button
            key={emoji}
            className={`reaction-btn ${hasUserReacted(message.reactions, emoji) ? 'reacted' : ''}`}
            onClick={() => toggleReaction(message._id, emoji)}
            title={users.join(', ')}
          >
            <span className="reaction-emoji">{emoji}</span>
            <span className="reaction-count">{users.length}</span>
          </button>
        ))}
        <button 
          className="add-reaction-btn"
          onClick={() => setShowEmojiPicker(message._id)}
          title="Add reaction"
        >
          ➕
        </button>
      </div>
    );
  };

  const renderEmojiPicker = (messageId) => {
    if (showEmojiPicker !== messageId) return null;
    
    return (
      <div className="emoji-picker">
        {commonEmojis.map(emoji => (
          <button
            key={emoji}
            className="emoji-option"
            onClick={() => {
              addReaction(messageId, emoji);
              setShowEmojiPicker(null);
            }}
            title={emoji}
          >
            {emoji}
          </button>
        ))}
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
                      {renderReactions(msg)}
                      {renderEmojiPicker(msg._id)}
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
                    socket.emit("typing", {room, username});
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
