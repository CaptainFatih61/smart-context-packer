AddEventHandler('onResourceStart', function(resourceName)
  if GetCurrentResourceName() == resourceName then
    print('Resource started: ' .. resourceName)
  end
end)
