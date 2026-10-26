import "./globals.css";

export const metadata = {
  title: "Media Tool List",
  description: "Task process flow chart and automation tool map"
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
