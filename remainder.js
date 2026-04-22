const cron = require("node-cron");
const db = require("./db");
const transporter = require("./utils/transpotar");
const QRCode = require("qrcode");

// =========================
// SMS FUNCTION (use your provider here)
// =========================
async function sendSMS(phone, message) {
  // 👉 Replace with Twilio / MSG91 / Fast2SMS
  console.log("📲 SMS sent to:", phone);
}

// =========================
// PHONE FORMATTER
// =========================
function formatPhone(phone) {
  return phone.startsWith("+") ? phone : "+91" + phone;
}

// =========================
// CRON JOB
// =========================
function startReminderJob() {
  console.log("🟢 Cron initialized (Daily 6 PM IST)");

  cron.schedule(
    "0 18 * * *", // every day 6:00 PM IST
    async () => {
      console.log("🔔 Running reminder job:", new Date());

      try {
        // ==============================
        // GET TOMORROW DATE (IST SAFE)
        // ==============================
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);

        const yyyy = tomorrow.getFullYear();
        const mm = String(tomorrow.getMonth() + 1).padStart(2, "0");
        const dd = String(tomorrow.getDate()).padStart(2, "0");

        const formattedDate = `${yyyy}-${mm}-${dd}`;

        // ==============================
        // FETCH APPOINTMENTS
        // ==============================
        const result = await db.query(
          `SELECT * FROM appointments 
           WHERE date = $1
           AND (reminder_sent IS NULL OR reminder_sent = false)`,
          [formattedDate]
        );

        console.log("📊 Found:", result.rows.length);

        for (let appt of result.rows) {
          if (!appt.patientemail) continue;

          // ==============================
          // QR GENERATION
          // ==============================
          if (!appt.qrdata) {
            console.log("❌ Missing QR data:", appt.id);
            continue;
          }

          const qrImage = await QRCode.toDataURL(appt.qrdata, {
            width: 300,
            margin: 2,
          });

          const qrBuffer = Buffer.from(qrImage.split(",")[1], "base64");

          // ==============================
          // EMAIL REMINDER
          // ==============================
          await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: appt.patientemail,
            subject: "⏰ Appointment Reminder",

            attachments: [
              {
                filename: "qr.png",
                content: qrBuffer,
                cid: "qrimage@pams",
              },
            ],

            html: `
              <div style="font-family:Arial;text-align:center;padding:15px">

                <h2 style="color:#1E3A8A">⏰ Appointment Reminder</h2>

                <p>Dear <b>${appt.name}</b>,</p>

                <p>This is a reminder for your <b>TOMORROW</b> appointment.</p>

                <hr/>

                <p><b>Doctor:</b> ${appt.doctorname}</p>
                <p><b>Date:</b> ${appt.date}</p>
                <p><b>Time:</b> ${appt.timeslot}</p>
                <p><b>Token:</b> ${appt.tokenid}</p>

                <hr/>

                <h3>📱 QR Code</h3>
                <img src="cid:qrimage@pams" width="180"/>

                <p>Please arrive 10–15 minutes early.</p>

                <p style="color:red;font-size:12px">
                  ⚠️ Do not reply to this email
                </p>

              </div>
            `,
          });

          // ==============================
          // 📲 SMS REMINDER (NEW)
          // ==============================
          if (appt.patientphone) {
            try {
              const phone = formatPhone(appt.patientphone);

              await sendSMS(
                phone,
                `⏰ Appointment Reminder

Dear ${appt.name},

Doctor: ${appt.doctorname}
Date: ${appt.date}
Time: ${appt.timeslot}
Token: ${appt.tokenid}

Please arrive 10–15 mins early.

- Hospital Management`
              );
            } catch (smsErr) {
              console.error("❌ SMS Error:", smsErr.message);
            }
          }

          // ==============================
          // MARK AS SENT
          // ==============================
          await db.query(
            `UPDATE appointments 
             SET reminder_sent = true 
             WHERE id = $1`,
            [appt.id]
          );

          console.log("✅ Sent reminder:", appt.patientemail);
        }

        console.log("✅ Reminder job completed");
      } catch (err) {
        console.error("❌ Reminder error:", err.message);
      }
    },
    {
      timezone: "Asia/Kolkata",
    }
  );
}

module.exports = startReminderJob;