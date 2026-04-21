const cron = require("node-cron");
const db = require("./db");
const QRCode = require("qrcode");
const transporter = require("./utils/transpotar");

function startReminderJob() {
  console.log("🟢 Cron initialized (TEST MODE)");

  // ⏱️ 1 MINUTE TEST (change later)
  cron.schedule(
    "*/1 * * * *",
    async () => {
      console.log("🔔 Running reminder job:", new Date());

      try {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);

        const date = tomorrow.toISOString().split("T")[0];

        const result = await db.query(
          `SELECT * FROM appointments 
           WHERE DATE(date) = $1 
           AND (reminder_sent IS NULL OR reminder_sent = false)`,
          [date]
        );

        console.log("📊 Found:", result.rows.length);

        for (let appt of result.rows) {
          if (!appt.patientemail || !appt.qrdata) continue;

          // ✅ Generate QR
          const qrImage = await QRCode.toDataURL(appt.qrdata, {
            width: 300,
            margin: 2,
          });

          // convert base64 → buffer
          const qrBuffer = Buffer.from(qrImage.split(",")[1], "base64");

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

                <h2>⏰ Appointment Reminder</h2>

                <p>Dear <b>${appt.name}</b>,</p>

                <p>Your appointment is scheduled for <b>TOMORROW</b>.</p>

                <hr/>

                <h3>👨‍⚕️ Doctor Details</h3>
                <p><b>Dr:</b> ${appt.doctorname}</p>
                <p><b>Date:</b> ${appt.date}</p>
                <p><b>Time:</b> ${appt.timeslot}</p>
                <p><b>Token:</b> ${appt.tokenid}</p>

                <hr/>

                <h3>📱 Scan QR Code</h3>

                <!-- ✅ THIS WILL SHOW LIKE GOOGLE PAY STYLE -->
                <img src="cid:qrimage@pams" width="180" />

                <p style="margin-top:10px;color:#555;font-size:13px">
                  Please arrive 10–15 minutes early.
                </p>

                <p style="color:red;font-size:12px">
                  Automated message. Do not reply.
                </p>

              </div>
            `,
          });

          await db.query(
            `UPDATE appointments SET reminder_sent = true WHERE id = $1`,
            [appt.id]
          );

          console.log("✅ Sent:", appt.patientemail);
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