ALTER TABLE user_service_token
ADD COLUMN paceme_user_id varchar(40);

UPDATE user_service_token
SET paceme_user_id = user_id;

ALTER TABLE user_service_token ALTER COLUMN paceme_user_id SET NOT NULL;

ALTER TABLE user_service_token
DROP COLUMN user_id;