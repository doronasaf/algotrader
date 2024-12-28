// install java 11

brew install --cask temurin

Step 2: Download and Install TWS or IB Gateway
TWS Installation: (GUI)

Go to the official IBKR TWS download page:
TWS Download

Download the MacOS installer for the Latest or Stable version.

Install it by running the .dmg file and dragging the app into your Applications folder.: https://www.interactivebrokers.co.uk/en/trading/ibgateway-latest.php


IB Gateway Installation: (PRODUCTION ENGINE )

Go to the official IBKR Gateway page:
IB Gateway Download
Download the MacOS installer.
Install it similarly to TWS.

Propmt to develop the client library similar to alpaca:
https://interactivebrokers.github.io/tws-api/introduction.html


IBKR Client Portal GW Setup:
=============================
- install from the documentation link
- install Java from the documentation link
- install certificate:

Use the keytool utility (provided with Java) or openssl to create the self-signed certificate.

Using openssl: Generate a Private Key:

    openssl genrsa -out server.key 2048

Create a Certificate Signing Request (CSR):

    openssl req -new -key server.key -out server.csr

You’ll be prompted to enter details like country, organization, etc.
For Common Name (CN), use localhost or the hostname where the gateway will run.
Generate the Self-Signed Certificate:

openssl x509 -req -days 365 -in server.csr -signkey server.key -out server.crt
This creates a certificate (server.crt) valid for 1 year.
Combine the Certificate and Key (if required): Some servers require a combined .pem file:

    cat server.crt server.key > server.pem

Configure the Certificate in the Client Portal Gateway
The Client Portal Gateway expects a keystore file (.jks) for SSL configuration.
Convert the Certificate to a Java Keystore:
Convert the Certificate and Key to PKCS12 Format:
    openssl pkcs12 -export -in server.crt -inkey server.key -out server.p12 -name clientportal
You’ll be prompted to set a password for the .p12 file.

Import the PKCS12 File into a Java Keystore:
    keytool -importkeystore -deststorepass changeit -destkeypass Wamwam23 -destkeystore server.jks -srckeystore server.p12 -srcstoretype PKCS12 -alias clientportal
Replace changeit with your desired password.
The resulting server.jks file is your Java keystore.!!!


