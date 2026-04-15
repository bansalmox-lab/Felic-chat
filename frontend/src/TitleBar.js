import React from 'react';
import './TitleBar.css';

// Using window.require to prevent webpack from trying to bundle electron
const electron = window.require ? window.require('electron') : null;

function TitleBar() {
  const handleMinimize = () => {
    if (electron) electron.ipcRenderer.send('window-min');
  };

  const handleMaximize = () => {
    if (electron) electron.ipcRenderer.send('window-max');
  };

  const handleClose = () => {
    if (electron) electron.ipcRenderer.send('window-close');
  };

  return (
    <div className="titlebar">
      <div className="titlebar-drag-region">
        <div className="titlebar-logo">
          <img src="/chat-logo.png" alt="Logo" />
          <span>FELIC CHAT</span>
        </div>
      </div>
      
      {electron && (
        <div className="titlebar-controls">
          <button className="control-btn minimize" onClick={handleMinimize} aria-label="Minimize">
            <span>&minus;</span>
          </button>
          <button className="control-btn maximize" onClick={handleMaximize} aria-label="Maximize">
            <span>&#9723;</span>
          </button>
          <button className="control-btn close" onClick={handleClose} aria-label="Close">
            <span>&#10005;</span>
          </button>
        </div>
      )}
    </div>
  );
}

export default TitleBar;
