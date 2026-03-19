# API Reference

All functionality is exposed through Supabase Edge Functions.

Base endpoint:

/functions/v1/{agent-name}

## Example

POST /functions/v1/email-agent

Request:

{
"sender": "agent@realestate.com",
"subject": "Potential development site",
"body": "Look at 12 Marine Parade Kingscliff",
"deal_id": "uuid"
}

Response:

{
"status": "processed",
"address_detected": true
}

## Core Endpoints

/email-agent  
/site-discovery-agent  
/site-intelligence-agent  
/zoning-agent  
/flood-agent  
/height-agent  
/fsr-agent  
/heritage-agent  
/yield-agent  
/parcel-ranking-agent