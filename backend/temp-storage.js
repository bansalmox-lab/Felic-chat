// In-memory storage for messages (temporary solution)
let messages = [];

const Message = {
  find: (query) => {
    let filteredMessages = messages;
    if (query && query.room) {
      filteredMessages = messages.filter(msg => msg.room === query.room);
    }
    // Pre-sort by createdAt; return chainable object for .sort() compatibility
    filteredMessages = filteredMessages.slice().sort((a, b) => a.createdAt - b.createdAt);
    return {
      sort: () => Promise.resolve(filteredMessages),
      then: (resolve, reject) => Promise.resolve(filteredMessages).then(resolve, reject)
    };
  },

  create: async function(data) {
    const message = {
      _id: Date.now().toString(),
      room: data.room,
      author: data.author,
      message: data.message,
      time: data.time,
      fileUrl: data.fileUrl || null,
      fileName: data.fileName || null,
      fileType: data.fileType || null,
      reactions: data.reactions || [],
      createdAt: new Date()
    };
    messages.push(message);
    return message;
  },

  findByIdAndUpdate: async function(id, update) {
    const idx = messages.findIndex(m => m._id === id || `${m.author}-${m.time}-${m.message}` === id);
    if (idx === -1) return null;
    if (update.$push) {
      const [key, val] = Object.entries(update.$push)[0];
      if (!messages[idx][key]) messages[idx][key] = [];
      messages[idx][key].push(val);
    }
    if (update.$pull) {
      const [key, val] = Object.entries(update.$pull)[0];
      if (messages[idx][key]) {
        messages[idx][key] = messages[idx][key].filter(
          r => !Object.entries(val).every(([k, v]) => r[k] === v)
        );
      }
    }
    return messages[idx];
  },

  findByIdAndDelete: async function(id) {
    const idx = messages.findIndex(m => m._id === id || `${m.author}-${m.time}-${m.message}` === id);
    if (idx === -1) return null;
    const deleted = messages[idx];
    messages.splice(idx, 1);
    return deleted;
  },

  deleteMany: async function(query) {
    if (query && query.room) {
      const initialLength = messages.length;
      messages = messages.filter(msg => msg.room !== query.room);
      return { deletedCount: initialLength - messages.length };
    }
    return { deletedCount: 0 };
  }
};

module.exports = Message;
