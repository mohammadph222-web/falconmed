import { createContext, useContext } from "react";

export const AuthContext = createContext({
  user: null,
  profile: null,
  role: "admin",
});

export const useAuthContext = () => useContext(AuthContext);
