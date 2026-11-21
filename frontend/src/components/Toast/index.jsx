import React, { useState, useEffect } from "react";

export default function Toast() {
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    const handleToast = (e) => {
      const id = Date.now();
      setToasts((prev) => [...prev, { id, ...e.detail }]);
      
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 4000);
    };

    window.addEventListener("toast", handleToast);
    return () => window.removeEventListener("toast", handleToast);
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div style={{ position: "fixed", bottom: "20px", right: "20px", zIndex: 9999 }}>
      {toasts.map((toast) => (
        <div 
          key={toast.id} 
          style={{
            background: toast.type === "warning" ? "#f59e0b" : "#333",
            color: "#fff",
            padding: "12px 20px",
            borderRadius: "6px",
            marginBottom: "10px",
            boxShadow: "0 4px 6px rgba(0,0,0,0.1)",
            transition: "opacity 0.3s"
          }}
        >
          {toast.message}
        </div>
      ))}
    </div>
  );
}
