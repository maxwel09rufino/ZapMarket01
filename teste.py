import requests
refresh_token = "TG-69c6d0fe4baed400017f5cd0-715734865"
url = "https://api.mercadolibre.com/oauth/token"

payload = f'grant_type=refresh_token&client_id=6193278062533842&client_secret=hoab4FbViHY8ns7AYfvDq6BWwhx0gQVS&refresh_token={refresh_token}'
headers = {
  'accept': 'application/json',
  'content-type': 'application/x-www-form-urlencoded'
}

response = requests.request("POST", url, headers=headers, data=payload)

print(response.text)
