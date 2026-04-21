const cron = require("node-cron");
const db = require("./db");
const transporter = require("./utils/transpotar");
const QRCode = require("qrcode");

function startReminderJob() {
  console.log("🟢 Cron initialized (1-min test mode)");

  cron.schedule(
    "* * * * *", // every 1 minute (testing)
    async () => {
      console.log("🔔 Running test reminder job:", new Date());

      try {
        // ==============================
        // ✅ FIX: NO toISOString(), NO UTC shift
        // ==============================

        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);

        const yyyy = tomorrow.getFullYear();
        const mm = String(tomorrow.getMonth() + 1).padStart(2, "0");
        const dd = String(tomorrow.getDate()).padStart(2, "0");

        const formattedDate = `${yyyy}-${mm}-${dd}`;

        // ==============================
        // ✅ FIX: Remove DATE() usage in SQL
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

          if (!appt.qrdata) {
            console.log("❌ Missing QR data:", appt.id);
            continue;
          }

          // ✅ Generate QR (base64 image)
          const qrImage = await QRCode.toDataURL(appt.qrdata, {
            width: 300,
            margin: 2,
          });
          const qrBuffer = Buffer.from(qrImage.split(",")[1], "base64");

          // 🚀 SEND EMAIL
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

                <p>
                  This is a reminder that your appointment is scheduled for <b>TOMORROW</b>.
                </p>

                <hr/>

                <h3>👨‍⚕️ Doctor Details</h3>
                <p><b>Dr:</b> ${appt.doctorname}</p>
                <p><b>Date:</b> ${appt.date}</p>
                <p><b>Time:</b> ${appt.timeslot}</p>
                <p><b>Token:</b> ${appt.tokenid}</p>

                <hr/>

                <h3>📱 Scan QR Code at Hospital</h3>

          <img src="cid:qrimage@pams" width="180"/>
                <p style="margin-top:15px;color:#444;font-size:14px">
                  Please arrive 10–15 minutes early.
                </p>

                <p style="color:#555;font-size:13px">
                  Thank you for choosing our hospital 🙏
                </p>

                <p style="color:red;font-size:12px">
                  ⚠️ This is an automated message. Please do not reply.
                </p>

              </div>
            `,
          });

          // ✅ mark as sent
          await db.query(
            `UPDATE appointments 
             SET reminder_sent = true 
             WHERE id = $1`,
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