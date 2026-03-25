import { useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabaseClient";
import "./AdminPanel.css";

const INITIAL_USER_FORM = {
  email: "",
  role: "pharmacist",
  organizationId: "",
  siteId: "",
};

const generateTempPassword = () => {
  const part = Math.random().toString(36).slice(2, 10);
  return `Falcon#${part}9`;
};

export default function AdminPanel() {
  const [organizations, setOrganizations] = useState([]);
  const [sites, setSites] = useState([]);
  const [users, setUsers] = useState([]);

  const [orgName, setOrgName] = useState("");
  const [siteForm, setSiteForm] = useState({ organizationId: "", name: "" });
  const [userForm, setUserForm] = useState(INITIAL_USER_FORM);

  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  const loadAll = async () => {
    setLoading(true);
    setMessage("");

    try {
      const [orgRes, siteRes, userRes] = await Promise.all([
        supabase.from("organizations").select("id, name, created_at").order("created_at", { ascending: false }),
        supabase
          .from("sites")
          .select("id, name, organization_id, created_at, organizations:organization_id(name)")
          .order("created_at", { ascending: false }),
        supabase
          .from("profiles")
          .select("id, full_name, role, organization_id, site_id, created_at, organizations:organization_id(name), sites:site_id(name)")
          .order("created_at", { ascending: false }),
      ]);

      if (orgRes.error) throw orgRes.error;
      if (siteRes.error) throw siteRes.error;
      if (userRes.error) throw userRes.error;

      setOrganizations(orgRes.data || []);
      setSites(siteRes.data || []);
      setUsers(userRes.data || []);
    } catch (err) {
      console.error("Admin panel load failed:", err?.message || "Unknown error");
      setMessage("Failed to load admin data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAll();
  }, []);

  const filteredSitesForUser = useMemo(() => {
    if (!userForm.organizationId) return sites;
    return sites.filter((x) => x.organization_id === userForm.organizationId);
  }, [sites, userForm.organizationId]);

  const handleCreateOrganization = async (e) => {
    e.preventDefault();
    setMessage("");

    if (!orgName.trim()) return;

    const { error } = await supabase.from("organizations").insert({ name: orgName.trim() });

    if (error) {
      console.error("Create organization failed:", error.message);
      setMessage("Failed to create organization.");
      return;
    }

    setOrgName("");
    setMessage("Organization created.");
    await loadAll();
  };

  const handleCreateSite = async (e) => {
    e.preventDefault();
    setMessage("");

    if (!siteForm.organizationId || !siteForm.name.trim()) return;

    const { error } = await supabase.from("sites").insert({
      organization_id: siteForm.organizationId,
      name: siteForm.name.trim(),
    });

    if (error) {
      console.error("Create site failed:", error.message);
      setMessage("Failed to create site.");
      return;
    }

    setSiteForm({ organizationId: "", name: "" });
    setMessage("Site created.");
    await loadAll();
  };

  const handleCreateUser = async (e) => {
    e.preventDefault();
    setMessage("");

    const email = userForm.email.trim().toLowerCase();
    if (!email || !userForm.role || !userForm.organizationId || !userForm.siteId) {
      return;
    }

    const { data: sessionData } = await supabase.auth.getSession();
    const adminSession = sessionData?.session;
    const tempPassword = generateTempPassword();

    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email,
      password: tempPassword,
      options: {
        data: {
          full_name: email,
        },
      },
    });

    if (signUpError) {
      console.error("Create user sign up failed:", signUpError.message);
      setMessage("Failed to create user account.");
      return;
    }

    const createdUserId = signUpData?.user?.id;
    if (!createdUserId) {
      setMessage("User created flow started, but profile could not be linked yet.");
      return;
    }

    const { error: profileError } = await supabase.from("profiles").upsert({
      id: createdUserId,
      full_name: email,
      role: userForm.role,
      organization_id: userForm.organizationId,
      site_id: userForm.siteId,
    });

    if (profileError) {
      console.error("Profile create/update failed:", profileError.message);
      setMessage("User account created, but profile linking failed.");
      return;
    }

    if (adminSession && signUpData?.session) {
      await supabase.auth.setSession({
        access_token: adminSession.access_token,
        refresh_token: adminSession.refresh_token,
      });
    }

    setUserForm(INITIAL_USER_FORM);
    setMessage(`User created. Temporary password: ${tempPassword}`);
    await loadAll();
  };

  return (
    <div className="admin-panel">
      <div className="admin-head">
        <h1>Super Admin Panel</h1>
        <p>Manage organizations, sites, and users.</p>
      </div>

      {message && <div className="admin-message">{message}</div>}

      <section className="admin-card">
        <div className="admin-card-title-row">
          <h2>Organizations</h2>
        </div>

        <form className="admin-form-row" onSubmit={handleCreateOrganization}>
          <input
            type="text"
            placeholder="Organization name"
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
          />
          <button type="submit">Create Organization</button>
        </form>

        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {organizations.map((org) => (
                <tr key={org.id}>
                  <td>{org.name}</td>
                  <td>{org.created_at ? new Date(org.created_at).toLocaleDateString() : "-"}</td>
                </tr>
              ))}
              {organizations.length === 0 && !loading && (
                <tr>
                  <td colSpan="2" className="empty-cell">
                    No organizations found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="admin-card">
        <div className="admin-card-title-row">
          <h2>Sites</h2>
        </div>

        <form className="admin-form-grid" onSubmit={handleCreateSite}>
          <select
            value={siteForm.organizationId}
            onChange={(e) => setSiteForm((prev) => ({ ...prev, organizationId: e.target.value }))}
            required
          >
            <option value="">Select organization</option>
            {organizations.map((org) => (
              <option key={org.id} value={org.id}>
                {org.name}
              </option>
            ))}
          </select>

          <input
            type="text"
            placeholder="Site name"
            value={siteForm.name}
            onChange={(e) => setSiteForm((prev) => ({ ...prev, name: e.target.value }))}
            required
          />

          <button type="submit">Create Site</button>
        </form>

        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Site</th>
                <th>Organization</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {sites.map((site) => (
                <tr key={site.id}>
                  <td>{site.name}</td>
                  <td>{site.organizations?.name || "-"}</td>
                  <td>{site.created_at ? new Date(site.created_at).toLocaleDateString() : "-"}</td>
                </tr>
              ))}
              {sites.length === 0 && !loading && (
                <tr>
                  <td colSpan="3" className="empty-cell">
                    No sites found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="admin-card">
        <div className="admin-card-title-row">
          <h2>Users</h2>
        </div>

        <form className="admin-form-grid users-grid" onSubmit={handleCreateUser}>
          <input
            type="email"
            placeholder="User email"
            value={userForm.email}
            onChange={(e) => setUserForm((prev) => ({ ...prev, email: e.target.value }))}
            required
          />

          <select
            value={userForm.role}
            onChange={(e) => setUserForm((prev) => ({ ...prev, role: e.target.value }))}
            required
          >
            <option value="admin">admin</option>
            <option value="manager">manager</option>
            <option value="pharmacist">pharmacist</option>
            <option value="storekeeper">storekeeper</option>
          </select>

          <select
            value={userForm.organizationId}
            onChange={(e) =>
              setUserForm((prev) => ({
                ...prev,
                organizationId: e.target.value,
                siteId: "",
              }))
            }
            required
          >
            <option value="">Select organization</option>
            {organizations.map((org) => (
              <option key={org.id} value={org.id}>
                {org.name}
              </option>
            ))}
          </select>

          <select
            value={userForm.siteId}
            onChange={(e) => setUserForm((prev) => ({ ...prev, siteId: e.target.value }))}
            required
          >
            <option value="">Select site</option>
            {filteredSitesForUser.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
          </select>

          <button type="submit">Create User</button>
        </form>

        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Organization</th>
                <th>Site</th>
              </tr>
            </thead>
            <tbody>
              {users.map((item) => (
                <tr key={item.id}>
                  <td>{item.full_name || item.id}</td>
                  <td>{item.role || "-"}</td>
                  <td>{item.organizations?.name || "-"}</td>
                  <td>{item.sites?.name || "-"}</td>
                </tr>
              ))}
              {users.length === 0 && !loading && (
                <tr>
                  <td colSpan="4" className="empty-cell">
                    No users found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
