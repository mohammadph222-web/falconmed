export default function LandingPage({ onAccess }) {
  return (
    <div style={pageWrap}>
      <div style={heroGlow} />
      <div style={heroCard}>
        <div style={brandPill}>FalconMed</div>
        <h1 style={title}>FalconMed</h1>
        <p style={subtitle}>Pharmacy Operations &amp; Clinical Intelligence Platform</p>

        <div style={featuresGrid}>
          <section style={featureCard}>
            <div style={featureIcon}>01</div>
            <h2 style={featureTitle}>Drug Intelligence</h2>
            <p style={featureText}>
              Search structured medication data quickly with cleaner access to drug details,
              coverage insights, and operational references.
            </p>
          </section>

          <section style={featureCard}>
            <div style={featureIcon}>02</div>
            <h2 style={featureTitle}>Inventory &amp; Expiry Management</h2>
            <p style={featureText}>
              Track critical expiry items, maintain visibility on stock risk, and support a
              safer pharmacy workflow with less friction.
            </p>
          </section>

          <section style={featureCard}>
            <div style={featureIcon}>03</div>
            <h2 style={featureTitle}>Shortage Tracking &amp; Analytics</h2>
            <p style={featureText}>
              Monitor shortage requests, surface operational bottlenecks, and keep teams aligned
              with a focused clinical operations view.
            </p>
          </section>
        </div>

        <div style={actionRow}>
          <button type="button" onClick={onAccess} style={accessButton}>
            Access Platform
          </button>
        </div>
      </div>
    </div>
  );
}

const pageWrap = {
  minHeight: "100vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "32px",
  background:
    "radial-gradient(circle at top left, rgba(59,130,246,0.12), transparent 32%), linear-gradient(180deg, #f8fbff 0%, #eef4fb 100%)",
  position: "relative",
  overflow: "hidden",
  fontFamily: "Arial, sans-serif",
};

const heroGlow = {
  position: "absolute",
  width: "520px",
  height: "520px",
  borderRadius: "999px",
  background: "rgba(37, 99, 235, 0.08)",
  filter: "blur(24px)",
  top: "-120px",
  right: "-120px",
};

const heroCard = {
  position: "relative",
  zIndex: 1,
  width: "100%",
  maxWidth: "1120px",
  background: "rgba(255,255,255,0.88)",
  backdropFilter: "blur(10px)",
  border: "1px solid rgba(226, 232, 240, 0.95)",
  boxShadow: "0 20px 50px rgba(15, 23, 42, 0.08)",
  borderRadius: "28px",
  padding: "42px",
};

const brandPill = {
  display: "inline-flex",
  alignItems: "center",
  padding: "7px 12px",
  borderRadius: "999px",
  background: "#e0ecff",
  color: "#1d4ed8",
  fontSize: "12px",
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  marginBottom: "18px",
};

const title = {
  margin: 0,
  fontSize: "54px",
  lineHeight: 1,
  letterSpacing: "-0.04em",
  color: "#0f172a",
};

const subtitle = {
  marginTop: "14px",
  marginBottom: "28px",
  maxWidth: "700px",
  color: "#475569",
  fontSize: "19px",
  lineHeight: 1.6,
};

const featuresGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
  gap: "18px",
  marginBottom: "28px",
};

const featureCard = {
  background: "white",
  borderRadius: "20px",
  padding: "22px",
  border: "1px solid #e5eaf1",
  boxShadow: "0 8px 24px rgba(15, 23, 42, 0.05)",
};

const featureIcon = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "38px",
  height: "38px",
  borderRadius: "12px",
  background: "#eff6ff",
  color: "#2563eb",
  fontWeight: 700,
  fontSize: "13px",
  marginBottom: "14px",
};

const featureTitle = {
  marginTop: 0,
  marginBottom: "10px",
  color: "#0f172a",
  fontSize: "20px",
  lineHeight: 1.25,
};

const featureText = {
  margin: 0,
  color: "#64748b",
  fontSize: "14px",
  lineHeight: 1.7,
};

const actionRow = {
  display: "flex",
  justifyContent: "flex-start",
};

const accessButton = {
  border: "none",
  background: "linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)",
  color: "white",
  padding: "13px 22px",
  borderRadius: "12px",
  fontSize: "15px",
  fontWeight: 700,
  cursor: "pointer",
  boxShadow: "0 10px 24px rgba(37, 99, 235, 0.22)",
};
