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
  const [loginErrorField, setLoginErrorField] = useState(''); // 'username' | 'password' | 'both' | ''
  const [showPassword, setShowPassword] = useState(false);
  const [isCheckingUsername, setIsCheckingUsername] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(null);
  const [pickerPosition, setPickerPosition] = useState({ top: 0, left: 0 });
  const [hoveredMessageId, setHoveredMessageId] = useState(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);

  const getAvatarSource = (avatarPath, fallbackName) => {
    if (!avatarPath) return `https://ui-avatars.com/api/?name=${encodeURIComponent(fallbackName)}&background=random`;
    if (avatarPath.startsWith('/uploads')) return `${BACKEND_URL}${avatarPath}`;
    return avatarPath;
  };

  const handleAvatarError = (e) => {
    if (!e.target.dataset.failed) {
      e.target.dataset.failed = "true";
      // Fully valid Base64 encoded generic SVG user icon
      e.target.src = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAyNCAyNCcgZmlsbD0nIzY2Nic+PGNpcmNsZSBjeD0nMTInIGN5PSc4JyByPSc0Jy8+PHBhdGggZD0nTTEyIDE0Yy00LjQyIDAtOCAyLjU4LTggNXYxaDE2di0xYzAtMi40Mi0zLjU4LTUtOC01eicvPjwvc3ZnPg==";
    }
  };

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
  const [allUsers, setAllUsers] = useState([]);
  const [usersSearchQuery, setUsersSearchQuery] = useState('');
  const [adminSearchQuery, setAdminSearchQuery] = useState('');
  const [userAvatar, setUserAvatar] = useState('');
  const [tempAvatar, setTempAvatar] = useState('');
  const [showAvatarModal, setShowAvatarModal] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [kickedFromPanel, setKickedFromPanel] = useState(new Set());
  // const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef(null);
  const chatEndRef = useRef(null);
  const currentRoomRef = useRef(''); // Always holds the current room for use in socket reconnect
  
  useEffect(() => {
    setKickedFromPanel(new Set());
  }, [room]);

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
          // Fetch live users and all users shortly after so server has time to process auth
          setTimeout(() => {
            fetch(`${BACKEND_URL}/api/live-users`)
              .then(r => r.json())
              .then(d => { if (d.users) setLiveUsers(d.users); })
              .catch(() => {});
            
            fetch(`${BACKEND_URL}/api/users`)
              .then(r => r.json())
              .then(d => { if (d.users) setAllUsers(d.users); })
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
      console.log('[FRONTEND_DEBUG] Message event received:', data);
      console.log('[FRONTEND_DEBUG] Current room state:', room);
      setRoomChats(prev => {
        const updated = {
          ...prev,
          [data.room]: [...(prev[data.room] || []), data]
        };
        console.log(`[FRONTEND_DEBUG] Updated chat length for ${data.room}:`, updated[data.room].length);
        return updated;
      });
    });

    newSocket.on('channel_created', (data) => {
      setChannels(prev => prev.includes(data.name) ? prev : [...prev, data.name]);
    });

    newSocket.on('channel_deleted', (data) => {
      setChannels(prev => prev.filter(c => c !== data.name));
      // Boot users out of the deleted channel
      setRoom(prevRoom => prevRoom === data.name ? 'General' : prevRoom);
    });

    newSocket.on('typing_users', (users) => {
      setTypingUsers(users);
    });

    newSocket.on('previous_messages', (data) => {
      console.log('[FRONTEND_DEBUG] previous_messages event received:', data.room, 'count:', data.messages.length);
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
      console.log('User joined event received:', data);
      if (data && data.room === currentRoomRef.current) {
        setKickedFromPanel(prev => {
          const next = new Set(prev);
          next.delete(data.username);
          return next;
        });
      }
    });

    newSocket.on('user_kicked', (data) => {
      console.log('User kicked event received:', data);
      if (data && data.room === currentRoomRef.current) {
        setKickedFromPanel(prev => new Set(prev).add(data.username));
      }
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

  // Poll live users every 10 seconds so the count stays fresh even if a
  // socket event is missed (e.g. brief network interruption).
  useEffect(() => {
    if (!isLoggedIn) return;
    const interval = setInterval(() => {
      fetch(`${BACKEND_URL}/api/live-users`)
        .then(r => r.json())
        .then(d => { if (d.users) setLiveUsers(d.users); })
        .catch(() => {});
    }, 10000);
    return () => clearInterval(interval);
  }, [isLoggedIn]);

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

  // handleLogout is defined below after handleLogin

  const clearLoginError = () => { setLoginError(''); setLoginErrorField(''); };

  const handleLogin = async () => {
    // Client-side validation
    if (!tempUsername.trim() && !password.trim()) {
      setLoginError('Please enter your username/email and password.');
      setLoginErrorField('both');
      return;
    }
    if (!tempUsername.trim()) {
      setLoginError('Please enter your username or email.');
      setLoginErrorField('username');
      return;
    }
    if (!password.trim()) {
      setLoginError('Please enter your password.');
      setLoginErrorField('password');
      return;
    }
    if (password.trim().length < 6) {
      setLoginError('Password must be at least 6 characters.');
      setLoginErrorField('password');
      return;
    }

    setIsCheckingUsername(true);
    clearLoginError();

    const email = tempUsername.trim();

    try {
      // ── Step 1: attempt login ────────────────────────────────
      const response = await fetch(`${BACKEND_URL}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: password.trim() })
      });

      const data = await response.json();

      if (response.ok) {
        // ── Login succeeded ────────────────────────────────────
        finishLogin(data.token, data.user);
        return;
      }

      if (response.status === 401) {
        // Wrong password for an existing account
        setLoginError('Incorrect password. Please try again.');
        setLoginErrorField('password');
        return;
      }

      if (response.status !== 404) {
        // Any other server error (not "user not found")
        setLoginError(data.message || 'Login failed. Please try again.');
        setLoginErrorField('both');
        return;
      }

      // ── Step 2: user not found → auto-register ───────────────
      console.log('User not found, attempting registration...');
      const registerResponse = await fetch(`${BACKEND_URL}/api/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: email, // use the input value as username
          email,
          password: password.trim(),
          avatar: tempAvatar.trim() || null
        })
      });

      const registerData = await registerResponse.json();

      if (registerResponse.ok) {
        finishLogin(registerData.token, registerData.user);
      } else {
        // Registration failed — most likely the account already exists (wrong password)
        const alreadyExists = registerData.message && registerData.message.toLowerCase().includes('already exists');
        if (alreadyExists) {
          setLoginError('Account already exists. Check your password and try again.');
          setLoginErrorField('password');
        } else {
          setLoginError(registerData.message || 'Could not create account. Please try again.');
          setLoginErrorField('both');
        }
      }
    } catch (error) {
      console.error('Login error:', error);
      setLoginError('Cannot reach the server. Check your connection and try again.');
      setLoginErrorField('both');
    } finally {
      // Always re-enable the button/form — success path calls setIsLoggedIn which unmounts this form
      setIsCheckingUsername(false);
    }
  };

  // Shared post-authentication logic (used for both login and auto-register)
  const finishLogin = (token, user) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
    setUsername(user.username);
    setUserAvatar(user.avatar || '');
    setIsAdmin(user.isAdmin || false);
    setIsLoggedIn(true);
    setTempUsername('');
    setPassword('');
    setTempAvatar('');
    setShowPassword(false);
    clearLoginError();
    if (socket) {
      socket.emit('authenticate', { token, user });
    }
    // Slight delay so the server has time to process the authenticate event
    setTimeout(fetchLiveUsers, 800);
    fetchAllUsers();
    fetchChannels();
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setIsLoggedIn(false);
    setUsername('');
    setRoom('');
    currentRoomRef.current = '';
    setRoomChats({});
    setPassword('');
    setUserAvatar('');
    setTempAvatar('');
    setIsAdmin(false);
    setLiveUsers([]);
    setAllUsers([]);
    // Disconnect existing socket so server removes this user from live tracking,
    // then reconnect to get a fresh unauthenticated socket for the next login.
    if (socket) {
      socket.disconnect();
      const newSocket = io(BACKEND_URL);
      setSocket(newSocket);
    }
  };

  const changeUsername = () => {
    if (tempUsername.trim()) {
      setUsername(tempUsername);
      setShowUsernameModal(false);
      setTempUsername('');
    }
  };

  const changeAvatar = async () => {
    if (tempAvatar.trim()) {
      const newAvatar = tempAvatar.trim();
      setUserAvatar(newAvatar);
      setShowAvatarModal(false);
      setTempAvatar('');
      const currentUser = JSON.parse(localStorage.getItem('user') || '{}');
      currentUser.avatar = newAvatar;
      localStorage.setItem('user', JSON.stringify(currentUser));
      
      try {
        const token = localStorage.getItem('token');
        await fetch(`${BACKEND_URL}/api/users/${encodeURIComponent(username)}/avatar`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ avatar: newAvatar })
        });
        fetchAllUsers();
      } catch (err) {
        console.error('Error saving avatar to backend:', err);
      }
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

  const fetchAllUsers = async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/users`, {
        headers: { 'Content-Type': 'application/json' },
      });
      if (response.ok) {
        const data = await response.json();
        setAllUsers(data.users);
      }
    } catch (error) {
      console.error('Error fetching all users:', error);
    }
  };

  const deleteAccount = async (userToDelete) => {
    if (!window.confirm(`Are you sure you want to permanently delete ${userToDelete} from the database?`)) return;
    const token = localStorage.getItem('token');
    try {
      const res = await fetch(`${BACKEND_URL}/api/users/${encodeURIComponent(userToDelete)}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        fetchAllUsers();
        fetchLiveUsers();
      } else {
        const d = await res.json();
        alert(d.message || 'Failed to delete user');
      }
    } catch (e) {
      alert('Server error while deleting');
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
    let path = null;
    if (liveUsers && liveUsers.length > 0) {
      const user = liveUsers.find(u => u.username === author);
      if (user && user.avatar && !user.avatar.includes('ui-avatars.com')) path = user.avatar;
    }
    if (!path && allUsers && allUsers.length > 0) {
      const user = allUsers.find(u => u.username === author);
      if (user && user.avatar && !user.avatar.includes('ui-avatars.com')) path = user.avatar;
    }
    if (!path && author === username && userAvatar && !userAvatar.includes('ui-avatars.com')) path = userAvatar;
    return getAvatarSource(path, author);
  };

  return (
    <div className="App">
      <TitleBar />
      {!isLoggedIn ? (
        <div className="login-container">
          {/* Animated background orbs */}
          <div className="login-orb login-orb-1" />
          <div className="login-orb login-orb-2" />
          <div className="login-orb login-orb-3" />

          <div className="login-panel">
            {/* Logo */}
            <div className="login-logo-wrap">
              <div className="login-logo-icon">
                <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="20" cy="20" r="20" fill="url(#lg1)"/>
                  <path d="M12 15h16M12 20h10M12 25h13" stroke="white" strokeWidth="2.5" strokeLinecap="round"/>
                  <defs>
                    <linearGradient id="lg1" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
                      <stop stopColor="#818cf8"/>
                      <stop offset="1" stopColor="#a855f7"/>
                    </linearGradient>
                  </defs>
                </svg>
              </div>
              <div className="login-logo-text">
                <span className="login-logo-felic">Felic</span>
                <span className="login-logo-chat">Chat</span>
              </div>
            </div>

            <h2 className="login-title">Sign in to your workspace</h2>
            <p className="login-subtitle">New here? We'll create your account automatically.</p>

            <div className="login-form">
              {/* Username / Email */}
              <div className="login-field">
                <label className="login-label">Username or Email</label>
                <div className="login-input-wrap">
                  <svg className="login-field-icon" viewBox="0 0 20 20" fill="none">
                    <path d="M10 10a4 4 0 100-8 4 4 0 000 8zM2 18c0-4 3.58-6 8-6s8 2 8 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                  </svg>
                  <input
                    type="text"
                    placeholder="you@example.com"
                    value={tempUsername}
                    onChange={(e) => { setTempUsername(e.target.value.toLowerCase()); clearLoginError(); }}
                    onKeyPress={(e) => e.key === 'Enter' && handleLogin()}
                    className={`login-input${(loginErrorField === 'username' || loginErrorField === 'both') ? ' error' : ''}`}
                    disabled={isCheckingUsername}
                    autoComplete="username"
                    id="login-username"
                  />
                </div>
              </div>

              {/* Password */}
              <div className="login-field">
                <label className="login-label">Password</label>
                <div className="login-input-wrap">
                  <svg className="login-field-icon" viewBox="0 0 20 20" fill="none">
                    <rect x="3" y="9" width="14" height="9" rx="2" stroke="currentColor" strokeWidth="1.6"/>
                    <path d="M7 9V6a3 3 0 016 0v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                  </svg>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Min. 6 characters"
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); clearLoginError(); }}
                    onKeyPress={(e) => e.key === 'Enter' && handleLogin()}
                    className={`login-input login-input-pw${(loginErrorField === 'password' || loginErrorField === 'both') ? ' error' : ''}`}
                    disabled={isCheckingUsername}
                    autoComplete="current-password"
                    id="login-password"
                  />
                  <button
                    type="button"
                    className="login-pw-toggle"
                    onClick={() => setShowPassword(v => !v)}
                    tabIndex={-1}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? (
                      <svg viewBox="0 0 20 20" fill="none">
                        <path d="M2 10s3-6 8-6 8 6 8 6-3 6-8 6-8-6-8-6z" stroke="currentColor" strokeWidth="1.6"/>
                        <circle cx="10" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.6"/>
                        <path d="M3 3l14 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                      </svg>
                    ) : (
                      <svg viewBox="0 0 20 20" fill="none">
                        <path d="M2 10s3-6 8-6 8 6 8 6-3 6-8 6-8-6-8-6z" stroke="currentColor" strokeWidth="1.6"/>
                        <circle cx="10" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.6"/>
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              {/* Avatar URL + live preview */}
              <div className="login-field">
                <label className="login-label">Avatar URL <span className="login-optional">(optional)</span></label>
                <div className="login-avatar-row">
                  <div className="login-avatar-preview">
                    <img
                      src={tempAvatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(tempUsername || 'You')}&background=818cf8&color=fff`}
                      alt="avatar preview"
                      onError={(e) => { e.target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(tempUsername || 'You')}&background=818cf8&color=fff`; }}
                    />
                  </div>
                  <div className="login-input-wrap login-avatar-input-wrap">
                    <svg className="login-field-icon" viewBox="0 0 20 20" fill="none">
                      <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.6"/>
                      <path d="M6 14c.9-2 5.1-2 6 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                      <circle cx="10" cy="8" r="2" stroke="currentColor" strokeWidth="1.6"/>
                    </svg>
                    <input
                      type="text"
                      placeholder="https://..."
                      value={tempAvatar}
                      onChange={(e) => { setTempAvatar(e.target.value); setLoginError(''); }}
                      onKeyPress={(e) => e.key === 'Enter' && handleLogin()}
                      className="login-input"
                      disabled={isCheckingUsername}
                    />
                  </div>
                </div>
              </div>

              {loginError && (
                <div className="login-error">
                  <svg viewBox="0 0 20 20" fill="none">
                    <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.6"/>
                    <path d="M10 6v4M10 14h.01" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                  </svg>
                  {loginError}
                </div>
              )}

              <button
                onClick={handleLogin}
                disabled={!tempUsername.trim() || !password.trim() || isCheckingUsername}
                className="login-button"
              >
                {isCheckingUsername ? (
                  <span className="login-spinner" />
                ) : (
                  <>
                    Continue
                    <svg viewBox="0 0 20 20" fill="none" style={{width:16,height:16,marginLeft:8}}>
                      <path d="M4 10h12M11 5l5 5-5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </>
                )}
              </button>

              <div className="login-features">
                <div className="login-feature"><span>⚡</span>Real-time messaging</div>
                <div className="login-feature"><span>🔒</span>Secure &amp; private</div>
                <div className="login-feature"><span>🌐</span>Multi-channel</div>
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
                  onClick={() => {
                    setShowAdminPanel(true);
                    fetchAllUsers();
                    fetchLiveUsers();
                  }}
                  title="Admin Panel"
                >
                  ⚙️ Admin
                </button>
              )}
              <button
                className="logout-btn"
                onClick={handleLogout}
                title="Logout"
              >
                🚪 Logout
              </button>
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
            <input 
              type="text" 
              className="user-search-bar" 
              placeholder="Search users..." 
              value={usersSearchQuery} 
              onChange={e => setUsersSearchQuery(e.target.value)} 
            />
            <div className="users-list">
              {(liveUsers || []).filter(u => u.username.toLowerCase().includes(usersSearchQuery.toLowerCase())).map((user) => (
                <div key={user.id} className="user-card">
                  <div className="user-avatar">
                    <img 
                      src={getAvatarSource(user.avatar, user.username)} 
                      alt={user.username}
                      onError={handleAvatarError}
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
              <h3 className="admin-section-title">👥 Manage Active Users</h3>
              <input 
                type="text" 
                className="admin-search-bar" 
                placeholder="Search active users..." 
                value={adminSearchQuery} 
                onChange={e => setAdminSearchQuery(e.target.value)} 
              />
              <div className="admin-user-list">
                {allUsers.filter(u => u.username !== username && !kickedFromPanel.has(u.username) && liveUsers.some(lu => lu.username === u.username) && u.username.toLowerCase().includes(adminSearchQuery.toLowerCase())).length === 0 && (
                  <div className="admin-empty">No active users found</div>
                )}
                {allUsers.filter(u => u.username !== username && !kickedFromPanel.has(u.username) && liveUsers.some(lu => lu.username === u.username) && u.username.toLowerCase().includes(adminSearchQuery.toLowerCase())).map(user => {
                  const isOnline = liveUsers.some(lu => lu.username === user.username);
                  return (
                    <div key={user.id} className="admin-user-row">
                      <img
                        src={getAvatarSource(user.avatar, user.username)}
                        alt={user.username}
                        className="admin-user-avatar"
                        onError={handleAvatarError}
                      />
                      <span className="admin-user-name">
                        {user.username}
                        <span className={`admin-status-dot ${isOnline ? 'online' : 'offline'}`} title={isOnline ? "Online" : "Offline"}></span>
                      </span>
                      <button
                        className="admin-kick-btn"
                        onClick={() => kickUser(user.username)}
                        title="Kick User"
                      >
                        👢 Kick
                      </button>
                    </div>
                  );
                })}
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
