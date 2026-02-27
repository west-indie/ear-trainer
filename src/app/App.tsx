import { useRoutes } from "react-router-dom";
import { routes } from "./routes";
import Shell from "../ui/Shell";

export default function App() {
  const element = useRoutes(routes);
  return <Shell>{element}</Shell>;
}