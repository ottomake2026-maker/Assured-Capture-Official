// server.ts
import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { initializeApp, getApps, getApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
var __filename = fileURLToPath(import.meta.url);
var __dirname = path.dirname(__filename);
var configPath = path.join(__dirname, "firebase-applet-config.json");
var firebaseConfig = { projectId: "ai-studio-assuredcapture" };
try {
  if (fs.existsSync(configPath)) {
    firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
  }
} catch (e) {
  console.warn("Notice loading firebase-applet-config.json:", e);
}
var adminApp = getApps().length === 0 ? initializeApp({
  projectId: firebaseConfig.projectId || "ai-studio-assuredcapture"
}) : getApp();
var adminAuth = getAuth(adminApp);
var databaseId = firebaseConfig.firestoreDatabaseId || "ai-studio-assuredcapture-513bf318-4d91-47b0-86f4-2eddbb15e73f";
var adminDb = getFirestore(adminApp, databaseId);
var app = express();
var PORT = Number(process.env.PORT) || 3e3;
app.use(express.json());
async function requireAdminAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized: Missing or invalid token" });
  }
  const token = authHeader.split("Bearer ")[1];
  try {
    const decodedToken = await adminAuth.verifyIdToken(token);
    const uid = decodedToken.uid;
    const email = (decodedToken.email || "").toLowerCase();
    let isAdministrator = email === "ottomake2026@gmail.com" || decodedToken.role === "Administrator" || decodedToken.admin === true;
    if (!isAdministrator) {
      try {
        const userDoc = await adminDb.collection("users").doc(uid).get();
        if (userDoc.exists && userDoc.data()?.role === "Administrator") {
          isAdministrator = true;
        }
      } catch {
      }
    }
    if (!isAdministrator) {
      return res.status(403).json({ error: "Forbidden: Administrator privileges required" });
    }
    req.user = {
      uid,
      email: decodedToken.email || "",
      displayName: decodedToken.name || (decodedToken.email ? decodedToken.email.split("@")[0] : "Administrator"),
      role: "Administrator",
      authTime: decodedToken.auth_time ? new Date(decodedToken.auth_time * 1e3).toISOString() : (/* @__PURE__ */ new Date()).toISOString()
    };
    next();
  } catch (err) {
    console.error("Server auth verification error:", err?.message || err);
    return res.status(401).json({ error: "Unauthorized: Invalid authentication session" });
  }
}
app.get("/api/auth/me", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized: Missing token" });
  }
  const token = authHeader.split("Bearer ")[1];
  try {
    const decodedToken = await adminAuth.verifyIdToken(token);
    const uid = decodedToken.uid;
    const email = (decodedToken.email || "").toLowerCase();
    let userRole = decodedToken.role || (email === "ottomake2026@gmail.com" ? "Administrator" : "User");
    let userDisabled = false;
    try {
      const userDoc = await adminDb.collection("users").doc(uid).get();
      if (userDoc.exists) {
        const data = userDoc.data() || {};
        userRole = data.role || userRole;
        userDisabled = userDisabled || Boolean(data.disabled || data.status === "Disabled");
      }
    } catch {
    }
    res.json({
      uid,
      email: decodedToken.email || "",
      displayName: decodedToken.name || (decodedToken.email ? decodedToken.email.split("@")[0] : "User"),
      role: userRole === "Administrator" ? "Administrator" : "User",
      disabled: userDisabled,
      status: userDisabled ? "Disabled" : "Active"
    });
  } catch (err) {
    res.status(401).json({ error: "Invalid token session" });
  }
});
function parseFirestoreDocFields(fields) {
  const result = {};
  for (const [k, v] of Object.entries(fields || {})) {
    const val = v;
    if (val.stringValue !== void 0) result[k] = val.stringValue;
    else if (val.booleanValue !== void 0) result[k] = val.booleanValue;
    else if (val.integerValue !== void 0) result[k] = Number(val.integerValue);
  }
  return result;
}
app.get("/api/admin/users", requireAdminAuth, async (req, res) => {
  const callerUser = req.user;
  const token = req.headers.authorization?.split("Bearer ")[1] || "";
  try {
    const authUsersResult = await adminAuth.listUsers(1e3);
    const authUsers = authUsersResult.users;
    const userList = authUsers.map((u) => {
      const email = u.email || "";
      const isRootAdmin = email.toLowerCase() === "ottomake2026@gmail.com";
      const role = isRootAdmin || u.customClaims?.role === "Administrator" ? "Administrator" : "User";
      const disabled = Boolean(u.disabled);
      const displayName = u.displayName || email || "User";
      return {
        uid: u.uid,
        email,
        displayName,
        role,
        disabled,
        status: disabled ? "Disabled" : "Active",
        createdAt: u.metadata.creationTime || (/* @__PURE__ */ new Date()).toISOString(),
        lastSignInTime: u.metadata.lastSignInTime
      };
    });
    return res.json({ users: userList });
  } catch (listErr) {
    console.warn("Notice: Firebase Admin listUsers unavailable, querying Firestore authorized_users directory:", listErr?.message || listErr);
    const allUsersMap = /* @__PURE__ */ new Map();
    allUsersMap.set(callerUser.uid, {
      uid: callerUser.uid,
      email: callerUser.email,
      displayName: callerUser.displayName || callerUser.email || "Administrator",
      role: "Administrator",
      disabled: false,
      status: "Active",
      createdAt: callerUser.authTime || (/* @__PURE__ */ new Date()).toISOString()
    });
    try {
      const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
        firebaseConfig.projectId
      )}/databases/${encodeURIComponent(databaseId)}/documents/authorized_users`;
      const fRes = await fetch(firestoreUrl, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      if (fRes.ok) {
        const fData = await fRes.json();
        const documents = fData.documents || [];
        for (const doc of documents) {
          const parsed = parseFirestoreDocFields(doc.fields);
          if (parsed.userId && !allUsersMap.has(parsed.userId)) {
            allUsersMap.set(parsed.userId, {
              uid: parsed.userId,
              email: parsed.email || "",
              displayName: parsed.displayName || parsed.email || "User",
              role: parsed.role === "Administrator" ? "Administrator" : "User",
              disabled: Boolean(parsed.disabled),
              status: Boolean(parsed.disabled) ? "Disabled" : "Active",
              createdAt: parsed.createdAt || (/* @__PURE__ */ new Date()).toISOString()
            });
          }
        }
      }
    } catch (fErr) {
      console.warn("Notice querying Firestore authorized_users:", fErr);
    }
    return res.json({ users: Array.from(allUsersMap.values()) });
  }
});
app.post("/api/admin/users", requireAdminAuth, async (req, res) => {
  try {
    const { email, password, fullName, displayName } = req.body;
    const token = req.headers.authorization?.split("Bearer ")[1] || "";
    const nameToUse = (fullName || displayName || "").trim();
    const emailToUse = (email || "").trim().toLowerCase();
    if (!nameToUse) {
      return res.status(400).json({ error: "Full Name is required" });
    }
    if (!emailToUse || !emailToUse.includes("@")) {
      return res.status(400).json({ error: "A valid email address is required" });
    }
    if (!password || typeof password !== "string" || password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }
    let createdUid = "";
    let creationDate = (/* @__PURE__ */ new Date()).toISOString();
    try {
      const newUserRecord = await adminAuth.createUser({
        email: emailToUse,
        password,
        displayName: nameToUse,
        disabled: false
      });
      createdUid = newUserRecord.uid;
      creationDate = newUserRecord.metadata.creationTime || creationDate;
    } catch (adminErr) {
      if (adminErr?.code === "auth/email-already-exists") {
        return res.status(409).json({ error: "A user with this email already exists." });
      }
      const apiKey = firebaseConfig.apiKey;
      if (!apiKey) {
        throw adminErr;
      }
      const restRes = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: emailToUse,
            password,
            displayName: nameToUse,
            returnSecureToken: true
          })
        }
      );
      const restData = await restRes.json();
      if (!restRes.ok || restData?.error) {
        const errMsg = restData?.error?.message;
        if (errMsg === "EMAIL_EXISTS") {
          return res.status(409).json({ error: "A user with this email already exists." });
        }
        if (errMsg === "INVALID_PASSWORD" || errMsg?.includes("PASSWORD")) {
          return res.status(400).json({ error: "Password must be at least 6 characters." });
        }
        if (errMsg === "INVALID_EMAIL") {
          return res.status(400).json({ error: "A valid email address is required." });
        }
        throw new Error(errMsg || "Failed to create user in Firebase");
      }
      createdUid = restData.localId;
    }
    const safeUserData = {
      uid: createdUid,
      email: emailToUse,
      displayName: nameToUse,
      role: "User",
      status: "Active",
      disabled: false,
      createdAt: creationDate
    };
    if (token) {
      try {
        const patchUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
          firebaseConfig.projectId
        )}/databases/${encodeURIComponent(databaseId)}/documents/authorized_users/${encodeURIComponent(createdUid)}`;
        await fetch(patchUrl, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            fields: {
              userId: { stringValue: createdUid },
              email: { stringValue: emailToUse },
              displayName: { stringValue: nameToUse },
              role: { stringValue: "User" },
              status: { stringValue: "Active" },
              disabled: { booleanValue: false },
              createdAt: { stringValue: creationDate }
            }
          })
        });
      } catch (saveErr) {
        console.warn("Notice persisting user to Firestore authorized_users:", saveErr);
      }
    }
    return res.status(201).json({
      success: true,
      message: "User created successfully.",
      user: safeUserData
    });
  } catch (err) {
    console.error("Create user error in server:", err?.code, err?.message);
    if (err?.code === "auth/email-already-exists") {
      return res.status(409).json({ error: "A user with this email already exists." });
    }
    if (err?.code === "auth/invalid-password") {
      return res.status(400).json({ error: "Password must be at least 6 characters." });
    }
    if (err?.code === "auth/invalid-email") {
      return res.status(400).json({ error: "The email address is invalid." });
    }
    return res.status(500).json({ error: "Unable to create user. Please try again." });
  }
});
app.patch("/api/admin/users/:uid/status", requireAdminAuth, async (req, res) => {
  try {
    const targetUid = req.params.uid;
    const { disabled } = req.body;
    const caller = req.user;
    const token = req.headers.authorization?.split("Bearer ")[1] || "";
    if (!targetUid || typeof targetUid !== "string") {
      return res.status(400).json({ error: "Valid user ID is required" });
    }
    if (typeof disabled !== "boolean") {
      return res.status(400).json({ error: "Invalid disabled flag. Boolean required." });
    }
    if ((caller.uid === targetUid || targetUid === "root_admin") && disabled) {
      return res.status(400).json({ error: "The Administrator account cannot be disabled." });
    }
    let updatedEmail = "";
    let updatedDisplayName = "";
    let updatedCreatedAt = (/* @__PURE__ */ new Date()).toISOString();
    try {
      const updatedUserRecord = await adminAuth.updateUser(targetUid, { disabled });
      updatedEmail = updatedUserRecord.email || "";
      updatedDisplayName = updatedUserRecord.displayName || "";
      updatedCreatedAt = updatedUserRecord.metadata.creationTime || updatedCreatedAt;
    } catch (adminErr) {
      const apiKey = firebaseConfig.apiKey;
      if (!apiKey) {
        throw adminErr;
      }
      const restRes = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:update?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            localId: targetUid,
            disableUser: disabled
          })
        }
      );
      const restData = await restRes.json();
      if (!restRes.ok || restData?.error) {
        throw new Error(restData?.error?.message || "Failed to update user status in Firebase");
      }
      updatedEmail = restData.email || "";
      updatedDisplayName = restData.displayName || "";
    }
    if (token) {
      try {
        const patchUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
          firebaseConfig.projectId
        )}/databases/${encodeURIComponent(databaseId)}/documents/authorized_users/${encodeURIComponent(
          targetUid
        )}?updateMask.fieldPaths=disabled&updateMask.fieldPaths=status`;
        await fetch(patchUrl, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            fields: {
              disabled: { booleanValue: disabled },
              status: { stringValue: disabled ? "Disabled" : "Active" }
            }
          })
        });
      } catch (fErr) {
        console.warn("Notice syncing status to Firestore authorized_users:", fErr);
      }
    }
    const updatedUser = {
      uid: targetUid,
      email: updatedEmail,
      displayName: updatedDisplayName || updatedEmail || "User",
      role: "User",
      status: disabled ? "Disabled" : "Active",
      disabled,
      createdAt: updatedCreatedAt
    };
    return res.json({
      success: true,
      message: "User status updated successfully.",
      user: updatedUser
    });
  } catch (err) {
    console.error("Update status error in server:", err?.message || err);
    return res.status(500).json({ error: "Unable to update user status. Please try again." });
  }
});
var distPath = fs.existsSync(path.join(__dirname, "dist", "index.html")) ? path.join(__dirname, "dist") : path.resolve(process.cwd(), "dist");
var indexPath = path.join(distPath, "index.html");
var hasBuiltDist = fs.existsSync(indexPath);
if (hasBuiltDist) {
  app.use(express.static(distPath));
  app.get("*", (_req, res) => {
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.status(200).send('<!doctype html><html><body><div id="root">Assured Capture active.</div></body></html>');
    }
  });
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: { middlewareMode: true, hmr: process.env.DISABLE_HMR !== "true" },
    appType: "spa"
  });
  app.use(vite.middlewares);
}
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Assured Capture server running on port ${PORT}`);
});
