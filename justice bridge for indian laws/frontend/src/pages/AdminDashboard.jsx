import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import "../App.css";

export default function AdminDashboard() {
  const [users, setUsers] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/admin/users`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.status === 403 || res.status === 401) {
        navigate("/");
        return;
      }

      const data = await res.json();
      
      // Safety check: Only set users if it's a valid array
      if (Array.isArray(data)) {
        setUsers(data);
      } else {
        console.error("Backend error:", data);
        setUsers([]); 
      }
    } catch (error) {
      console.error("Network error:", error);
      setUsers([]);
    }
  };

  const handleDelete = async (userId) => {
    if (!window.confirm("Are you sure you want to delete this user?")) return;

    const token = localStorage.getItem("token");
    const res = await fetch(`${import.meta.env.VITE_API_URL}/api/admin/users/${userId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.ok) {
      setUsers(users.filter((user) => user._id !== userId));
    } else {
      alert("Failed to delete user");
    }
  };

  const handleLogout = () => {
    localStorage.clear();
    navigate("/");
  };

  return (
    <div className="admin-container">
      <div className="admin-header">
        <h2>👑 Admin Dashboard</h2>
        <button className="logout-btn" onClick={handleLogout}>Logout</button>
      </div>

      <div className="table-wrapper">
        <table className="user-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              {/* 🚀 New Headers */}
              <th>Total Queries</th>
              <th>Active Sessions</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user._id}>
                <td>{user.name}</td>
                <td>{user.email}</td>
                <td>
                  <span className={`role-badge ${user.role}`}>{user.role}</span>
                </td>
                
                {/* 🚀 New Data Columns */}
                <td style={{ fontWeight: "bold", color: "#1dd1a1", textAlign: "center" }}>
                  {user.totalQueries || 0}
                </td>
                <td style={{ color: "#a8c7fa", textAlign: "center" }}>
                  {user.totalSessions || 0}
                </td>

                <td>
                  {user.role !== "admin" && ( // Protect Admin from deleting themselves
                    <button 
                      className="delete-btn" 
                      onClick={() => handleDelete(user._id)}
                    >
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}