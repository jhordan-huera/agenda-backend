import { Router } from "express";
import { handle, limitRequests } from "../http/handlers.ts";
import { requireSuperAdminTwoFactor } from "../http/session.ts";
import { pushDeviceService } from "../services/push-device-service.ts";

/**
 * /api/push: los avisos en el celular (spec 013). Con sesión y la cabecera X-Requested-With, como el
 * resto del panel. Sólo el propietario de un negocio activo, el rol Profesional con su agenda (el
 * resumen de las 8, spec 017) y el super admin (que sin la verificación en dos pasos recibe
 * `two_factor_required`). El aparato va siempre en el cuerpo, nunca en la URL.
 */
export const pushRoutes = Router();

pushRoutes.use(requireSuperAdminTwoFactor);

const deviceLimit = limitRequests({
  name: "avisos-aparato",
  windowMinutes: 15,
  max: 30,
  message: "Demasiados cambios en los avisos desde esta conexión. Espera unos minutos.",
});
const testLimit = limitRequests({
  name: "aviso-prueba",
  windowMinutes: 15,
  max: 5,
  message: "Ya enviamos varios avisos de prueba. Espera unos minutos para mandar otro.",
});

pushRoutes.get(
  "/config",
  handle((req) => pushDeviceService.getConfig(req.ctx)),
);
pushRoutes.put(
  "/device",
  deviceLimit,
  handle((req) => pushDeviceService.saveDevice(req.ctx, req.body, req.get("user-agent") ?? null)),
);
pushRoutes.patch(
  "/device",
  deviceLimit,
  handle((req) => pushDeviceService.updateKinds(req.ctx, req.body, req.get("user-agent") ?? null)),
);
pushRoutes.post(
  "/device/off",
  deviceLimit,
  handle((req) => pushDeviceService.turnOff(req.ctx, req.body, req.get("user-agent") ?? null)),
);
pushRoutes.post(
  "/device/test",
  testLimit,
  handle((req) => pushDeviceService.sendTest(req.ctx, req.body, req.get("user-agent") ?? null)),
);
