local utils = require('client.utils')

Citizen.CreateThread(function()
  while true do
    Citizen.Wait(1000)
    if Config.Debug then
      Utils.DrawText3D(0.0, 0.0, 72.0, "Active Resource")
    end
  end
end)
