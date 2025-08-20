import nodemailer from 'nodemailer';

let transporter: nodemailer.Transporter;

const initializeTransporter = async () => {
    // Check for Gmail SMTP config (production)
    if (process.env.SMTP_USER && process.env.SMTP_PASS) {
        transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS  // Use App Password, not regular password
            }
        });
        console.log('📧 Email Service: Gmail SMTP configured');
        console.log(`   From: ${process.env.SMTP_USER}`);
    } else {
        // Fallback: Use Ethereal for development (fake email for testing)
        const testAccount = await nodemailer.createTestAccount();
        transporter = nodemailer.createTransport({
            host: 'smtp.ethereal.email',
            port: 587,
            secure: false,
            auth: {
                user: testAccount.user,
                pass: testAccount.pass
            }
        });
        console.log('📧 Email Service: Ethereal (Development)');
        console.log('   ⚠️  Set SMTP_USER and SMTP_PASS in .env for real emails');
    }
};

// Initialize on start
initializeTransporter().catch(console.error);

export const sendOTP = async (email: string, otp: string) => {
    if (!transporter) await initializeTransporter();

    console.log(`📧 Sending OTP to ${email}`);

    const info = await transporter.sendMail({
        from: `"AquaFeed Pro" <${process.env.SMTP_USER || 'auth@aquafeedpro.com'}>`,
        to: email,
        subject: 'Your Login Code - AquaFeed Pro',
        text: `Your login code is: ${otp}. It expires in 10 minutes.`,
        html: `
            <div style="font-family: sans-serif; padding: 20px; color: #333; max-width: 400px;">
                <h2 style="color: #10B981;">🐟 AquaFeed Pro</h2>
                <p>Use the code below to log in:</p>
                <h1 style="background: #f0f0f0; padding: 15px 25px; display: inline-block; letter-spacing: 8px; border-radius: 8px; font-size: 32px;">${otp}</h1>
                <p style="color: #666; font-size: 14px;">This code expires in 10 minutes.</p>
                <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
                <p style="color: #999; font-size: 12px;">If you didn't request this code, ignore this email.</p>
            </div>
        `
    });

    // Log preview URL for Ethereal (dev only)
    if (!process.env.SMTP_USER) {
        console.log('📨 Preview Email:', nodemailer.getTestMessageUrl(info));
    } else {
        console.log('📨 Email sent successfully');
    }

    return info;
};
