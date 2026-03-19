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

Test agent example:

POST /functions/v1/test-agent

Request:

{
"deal_id": "test-deal-001",
"message": "Run test-agent health check"
}

Response:

{
"status": "success",
"agent": "test-agent"
}

Comparable sales example:

POST /functions/v1/comparable-sales-agent

Request:

{
"deal_id": "test-deal-001",
"radius_km": 5,
"dwelling_type": "apartment"
}

Response:

{
"success": true,
"deal_id": "test-deal-001",
"estimate_id": "uuid",
"estimated_sale_price_per_sqm": 12500,
"currency": "AUD",
"comparables": []
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
/test-agent  
/comparable-sales-agent
