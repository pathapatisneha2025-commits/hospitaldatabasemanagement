require("dotenv").config(); // Load env vars

const express = require("express");
const cors = require("cors");
const path = require("path"); // ✅ ADD THIS LINE
const startReminderJob = require("./remainder");
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
const Medicines = require("./routes/medicines"); 
const Medicinecart = require("./routes/medicinecart"); 
const DeliveryAddress = require("./routes/deliveryaddress"); 
const Medicineorder = require("./routes/ordermedicine"); 
const OrderCancelled = require("./routes/cancelorder"); 
const Medicinecategory = require("./routes/medicinecategory"); 
const SalesOrders = require("./routes/salesorders"); 

const BreakInattendance = require("./routes/AdminApis/attendancebreak"); 
const LatetoCome = require("./routes/AdminApis/latetocome"); 
const Manageexpenses = require("./routes/AdminApis/manageexpenses"); 
const Projects = require("./routes/AdminApis/projects"); 
const Admintask = require("./routes/AdminApis/Admintasks"); 
const Managesuppliers = require("./routes/AdminApis/managesuppliers"); 
const PurchaseOrders = require("./routes/AdminApis/purchaseorders"); 
const ManageChallan = require("./routes/AdminApis/managechallan"); 
const LeavesDeduction = require("./routes/AdminApis/leavesdeduction"); 
const Latepenality = require("./routes/AdminApis/latepenalities"); 
const Breakpenality = require("./routes/AdminApis/breakpenality"); 
const Generateinvoice = require("./routes/AdminApis/generateinvoice"); 
const Billingpatient = require("./routes/billingpatient"); 
const DeliveryBoy = require("./routes/AdminApis/deliveryboy"); 
const doctorBooking = require("./routes/AdminApis/doctorbooking"); 
const SubAdmin = require("./routes/AdminApis/subadmin"); 
const AdminLogin = require("./routes/AdminApis/adminlogin"); 
const EmpPharmacypasswords = require("./routes/AdminApis/pharmacypassword"); 
const DoctorModule = require("./routes/doctor"); 
const Doctorbookingtoken = require("./routes/AdminApis/doctorbookingtokens"); 
const Doctorrequest = require("./routes/AdminApis/doctorrequest"); 
const Empworkingdays = require("./routes/empworkingdays"); 
const Employeekpis = require("./routes/employeekpi"); 
const Empallowances = require("./routes/employeeallowances"); 
const Empallowancesusage = require("./routes/employeeallowanceusage"); 
const DoctorConsultanceFees = require("./routes/doctorconsultancefees"); 
const SalaryDeductions = require("./routes/salarydeductions"); 
const EmployeeDeductions = require("./routes/employeedeductions"); 
const Pickersapis = require("./routes/AdminApis/pickerapis"); 
const Deptleavelimit = require("./routes/leavelimitdepartment"); 

const cronRoutes = require("./routes/AdminApis/cron");
const DoctorSlots =   require("./routes/slotsdoctor"); 
const MedicineAddFileds =   require("./routes/addmedicinefields"); 
const AddpurchsaeorderFields =   require("./routes/Adminaddpurchasefield"); 
const CreateSalesorderfields =   require("./routes/Createsalesorderfieldsadd"); 
const GetStock =   require("./routes/getstock"); 
const EcogreenRoutes =   require("./routes/ecogreenroutes"); 
const EcogreenBulkupload =   require("./routes/ecogreenbulkapiroutes"); 
const EcogreenSingleapi =   require("./routes/ecogreensingleapisroutes"); 
const ReserveToken =   require("./routes//AdminApis/reservetokens"); 








// WebSocket setup
const WebSocket = require("ws");
const clients = new Map();

const app = express();
const PORT = process.env.PORT || 5000;
app.use(
  "/assets",
  express.static(path.join(__dirname, "assets"))
);
app.use(cors({
  origin: "*",              // Allow all domains (Web + Mobile)
  methods: ["GET","POST","PUT","DELETE","OPTIONS"],
  allowedHeaders: ["Content-Type","Authorization"]
}));

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
app.use("/medicine",Medicines); 
app.use("/cart",Medicinecart); 
app.use("/delivery-addresses",DeliveryAddress); 
app.use("/order-medicine",Medicineorder); 
app.use("/cancel-order", OrderCancelled); 
app.use("/medicine-category", Medicinecategory); 
app.use("/salesorders", SalesOrders); 
app.use("/BreakIn-attendance", BreakInattendance); 
app.use("/late_tocome", LatetoCome); 
app.use("/expenses", Manageexpenses); 
app.use("/projects", Projects); 
app.use("/Admintask",Admintask ); 
app.use("/Manage-suppliers",Managesuppliers ); 
app.use("/purchase-orders",PurchaseOrders ); 
app.use("/manage-challan",ManageChallan ); 
app.use("/leavededuction",LeavesDeduction ); 
app.use("/latepenalities",Latepenality ); 
app.use("/breakpenality",Breakpenality ); 
app.use("/invoice",Generateinvoice ); 
app.use("/billingpatient", Billingpatient ); 
app.use("/deliveryboy",DeliveryBoy ); 
app.use("/doctorbooking",doctorBooking  ); 
app.use("/subadmin",SubAdmin ); 
app.use("/adminlogin",AdminLogin ); 
app.use("/pharmacypassword",EmpPharmacypasswords ); 
app.use("/doctor",DoctorModule); 
app.use("/doctorbookingtoken",Doctorbookingtoken); 
app.use("/doctorrequest",Doctorrequest); 
app.use("/empworkingdays",Empworkingdays); 
app.use("/employeekpi",Employeekpis); 
app.use("/employeeallowances",Empallowances); 
app.use("/allowanceuseage",Empallowancesusage); 
app.use("/doctorconsultancefee",DoctorConsultanceFees); 
app.use("/salarydeduction",SalaryDeductions); 
app.use("/employeededuction",EmployeeDeductions); 
app.use("/picker",Pickersapis); 
app.use("/leavelimit",Deptleavelimit); 
app.use("/doctorslots",DoctorSlots); 
app.use("/addfields",MedicineAddFileds); 
app.use("/purchaseorderfields",AddpurchsaeorderFields); 
app.use("/CreateSalesorderfields",CreateSalesorderfields); 
app.use("/Getstock",GetStock); 
app.use("/ecogreen",EcogreenRoutes); 
app.use("/ecogreenbulkupload",EcogreenBulkupload); 
app.use("/ecogreensingleapis",EcogreenSingleapi); 
app.use("/reservetokens",ReserveToken); 







app.use("/cron", cronRoutes);

// Start HTTP server
const server = app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
    startReminderJob();

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
