from cryptography.fernet import Fernet

# Gera uma chave Fernet válida (base64, 44 caracteres)
key = Fernet.generate_key()
print(key.decode())  # Exemplo: b'xK9j...'