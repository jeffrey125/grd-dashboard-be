# Database foreign keys

For every new foreign key, explicitly use `ON DELETE NO ACTION` in migrations
and the corresponding ORM mapping. Use another delete action only when the user
explicitly approves an override for that relationship.
