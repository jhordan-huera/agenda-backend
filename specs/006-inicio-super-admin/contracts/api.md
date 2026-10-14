# Contrato de la API: Inicio del super admin con datos importantes

Sólo para el super admin (rutas `/admin/*`, como hoy). No hay rutas nuevas: dos respuestas ganan campos.

## `GET /admin/stats`

```jsonc
{
  "businesses": { "total": 6, "active": 5, "suspended": 1, "newThisMonth": 1 },
  "businessesByPlan": { "free": 3, "pro": 2, "business": 1 },
  "users": 11,
  "appointmentsThisMonth": 275,
  "onlineBookingsThisMonth": 73,
  "signupsByMonth": [ /* sin cambios; el panel ya no lo usa */ ],
  "growth": {                                    // NUEVO
    "from": "2026-10-01", "to": "2026-10-13",
    "previousFrom": "2026-09-01", "previousTo": "2026-09-13",
    "appointments": { "current": 275, "previous": 233 },
    "onlineBookings": { "current": 73, "previous": 69 },
    "newClients": { "current": 42, "previous": 43 },
    "newBusinesses": { "current": 1, "previous": 1 },
    "daily": [                                   // NUEVO (historia 5): un día por fila
      { "day": 1, "current": { "appointments": 20, "onlineBookings": 5, "newClients": 3 },
                  "previous": { "appointments": 18, "onlineBookings": 4, "newClients": 2 } },
      { "day": 31, "current": null, "previous": { "appointments": 9, "onlineBookings": 2, "newClients": 0 } }
    ]
  },
  "health": {                                    // NUEVO
    "emailsToday": { "sent": 38, "failed": 0, "queued": 0 },
    "cron": { "lastRunAt": "2026-10-14T03:50:06Z", "failures": 0 },
    "backup": { "ranAt": "2026-10-09T08:17:00Z", "ok": true, "sizeBytes": 2097152, "error": "" },
    "security": { "failedLogins24h": 3, "accountsOnAlert": 0 },
    "emailsByDay": [ { "date": "2026-10-01", "sent": 31, "failed": 0 } ]   // NUEVO: 14 días, hoy el último
  }
}
```

- **Sin pasadas del cron:** `cron.lastRunAt` es `null`.
- **Sin copias anotadas:** `backup` es `null`.
- **Datos personales:** ninguno. No va ningún email, cuenta ni nombre de paciente, sólo cifras.

## `GET /admin/businesses` y `GET /admin/businesses/:id`

Cada negocio gana:

```jsonc
"growth": { "current": 120, "previous": 80 }   // citas agendadas: periodo actual / mismo periodo del mes pasado
```
