require("dotenv").config(); // Load env vars

const express = require("express");
const cors = require("cors");

// Import routes
const employeeRoutes = require("./routes/employee");
const attendanceRoutes = require("./routes/attendance");
const taskRoutes = require("./routes/task");
const leavesRoutes = require("./routes/leaves");
const leavepolicies = require("./routes/leavepolicies");
const notificationRoutes = require("./routes/notifications"); 
const scheduleRoutes = require("./routes/schedule"); 
const PayslipsRoutes = require("./routes/payslips"); 
const Department = require("./routes/department"); 
const Role = require("./routes/role"); 
const Patient = require("./routes/patient"); 
const Bookappointment = require("./routes/appointment"); 
const Doctorsfees = require("./routes/doctorsfee"); 






// WebSocket setup
const WebSocket = require("ws");
const clients = new Map();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Register routes
app.use("/employee", employeeRoutes);
app.use("/attendance", attendanceRoutes);
app.use("/task", taskRoutes);
app.use("/leaves", leavesRoutes);
app.use("/leavepolicies", leavepolicies);
app.use("/notifications", notificationRoutes); 
app.use("/schedule", scheduleRoutes); 
app.use("/payslips", PayslipsRoutes); 
app.use("/department", Department); 
app.use("/role", Role); 
app.use("/patient", Patient); 
app.use("/book-appointment",Bookappointment); 
app.use("/consultancefee",Doctorsfees); 







// Start HTTP server
const server = app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});

// Attach WebSocket server to the same HTTP server
const wss = new WebSocket.Server({ server });

wss.on("connection", (ws) => {
  console.log("✅ New WebSocket client connected");

  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg);
      if (data.type === "register" && data.employeeId) {
        clients.set(data.employeeId.toString(), ws);
        console.log(` Employee ${data.employeeId} registered for notifications`);
      }
    } catch (err) {
      console.error("❌ Invalid WS message", err.message);
    }
  });

  ws.on("close", () => {
    console.log("❌ WebSocket client disconnected");
    for (let [id, client] of clients.entries()) {
      if (client === ws) {
        clients.delete(id);
      }
    }
  });
});

// Make clients accessible in routes
global.clients = clients;
